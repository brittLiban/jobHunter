const AUTO_FILL_FLAG_PREFIX = "jobhunter_autofill_done_";

const FIELD_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable='true']",
  "[contenteditable='']",
  "[role='textbox']",
].join(", ");

const REQUIRED_SELECTOR = [
  "input[required]",
  "textarea[required]",
  "select[required]",
  "input[aria-required='true']",
  "textarea[aria-required='true']",
  "select[aria-required='true']",
].join(", ");

const ATTACH_BUTTON_PATTERNS = [
  "attach",
  "upload",
  "resume",
  "resume cv",
  "cv",
];

const BLOCKED_BUTTON_PATTERNS = [
  "submit",
  "apply now",
  "continue",
  "next",
  "finish",
];

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return false;
  }

  if (message.type === "JOBHUNTER_AUTOFILL_CURRENT_TAB") {
    runAutofill({
      applicationId: message.applicationId || "",
      refreshMaterials: Boolean(message.refreshMaterials),
    })
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Autofill failed.",
        }))
    ;
    return true;
  }

  if (message.type === "JOBHUNTER_APPLY_PACKET") {
    applyPacket(message.packet || {}, message.resumeFile || null)
      .then((report) => sendResponse({
        ok: true,
        ...report,
      }))
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Could not apply packet in this frame.",
      }));
    return true;
  }

  if (message.type === "JOBHUNTER_AUTO_SUBMIT") {
    const submitted = tryClickSubmit();
    sendResponse({ ok: true, submitted });
    return false;
  }

  if (message.type === "JOBHUNTER_EXTRACT_QUESTIONS") {
    sendResponse({ ok: true, formQuestions: extractFormQuestions() });
    return false;
  }

  return false;
});

const pageUrl = new URL(window.location.href);
const hintedApplicationId = pageUrl.searchParams.get("jhApplicationId");
if (hintedApplicationId) {
  const onceKey = `${AUTO_FILL_FLAG_PREFIX}${hintedApplicationId}`;
  if (!sessionStorage.getItem(onceKey)) {
    sessionStorage.setItem(onceKey, "1");
    window.setTimeout(() => {
      chrome.runtime.sendMessage({
        type: "JOBHUNTER_AUTOFILL_TAB",
        applicationId: hintedApplicationId,
        refreshMaterials: pageUrl.searchParams.get("jhRefresh") === "1",
        autoSubmit: pageUrl.searchParams.get("jhAutoSubmit") === "1",
        pageUrl: window.location.href,
      }).catch(() => undefined);
    }, 650);
  }
}

async function runAutofill(input) {
  const response = await chrome.runtime.sendMessage({
    type: "JOBHUNTER_FETCH_PACKET",
    applicationId: input.applicationId,
    pageUrl: window.location.href,
    refreshMaterials: input.refreshMaterials,
  });

  if (!response?.ok) {
    return {
      ok: false,
      error: response?.error || "Could not fetch extension packet.",
    };
  }

  const packet = response.packet || {};
  const resumeFile = response.resumeFile || null;
  const report = await applyPacket(packet, resumeFile);
  return {
    ok: true,
    ...report,
  };
}

async function applyPacket(packet, resumeFile) {
  const defaults = packet.structuredDefaults || {};
  const generatedAnswers = Array.isArray(packet.generatedAnswers) ? packet.generatedAnswers : [];
  const answerLookup = buildAnswerLookup(generatedAnswers, defaults);
  const fieldOverrides = normalizeOverrideMap(packet.fieldOverrides);

  let fields = collectFormFieldsDeep();
  let detectedFieldCount = fields.length;

  let resumeUploaded = false;
  if (resumeFile?.base64) {
    resumeUploaded = await tryResumeUpload(resumeFile, fields);
    if (!resumeUploaded) {
      const clicked = triggerResumeAttachButtons();
      if (clicked > 0) {
        await delay(250);
        fields = collectFormFieldsDeep();
        detectedFieldCount = fields.length;
        resumeUploaded = await tryResumeUpload(resumeFile, fields);
      }
    }
  }

  let filledFieldCount = 0;
  let usableFieldCount = 0;

  for (const field of fields) {
    if (!isSupportedField(field)) {
      continue;
    }
    if (isFileInput(field)) {
      continue;
    }
    if (!isUsableField(field)) {
      continue;
    }
    usableFieldCount += 1;

    const descriptor = describeField(field);
    const value = resolveFieldValue({
      field,
      descriptor,
      defaults,
      answerLookup,
      fieldOverrides,
    });
    if (!value) {
      continue;
    }

    const changed = await applyValue(field, value, descriptor);
    if (changed) {
      filledFieldCount += 1;
    }
  }

  const unresolvedRequired = collectUnresolvedRequiredFieldsDeep();
  return {
    filledFieldCount,
    detectedFieldCount,
    usableFieldCount,
    resumeUploaded,
    unresolvedCount: unresolvedRequired.length,
    unresolvedRequired,
    frameUrl: window.location.href,
  };
}

function collectFormFieldsDeep() {
  const candidates = collectDeepElements(FIELD_SELECTOR);
  return uniqueElements(candidates.filter((element) => isSupportedField(element)));
}

function collectUnresolvedRequiredFieldsDeep() {
  const required = collectDeepElements(REQUIRED_SELECTOR)
    .filter((item) => isSupportedField(item));
  const unresolved = [];
  const radioGroupsSeen = new Set();

  for (const field of required) {
    if (!isSupportedField(field)) {
      continue;
    }

    if (isFileInput(field)) {
      const fileInput = field;
      if (!fileInput.files || fileInput.files.length === 0) {
        unresolved.push(getFieldLabel(field) || "Resume upload");
      }
      continue;
    }

    if (isChoiceInput(field)) {
      const input = field;
      const groupKey = input.name ? `name:${normalize(input.name)}` : `id:${normalize(input.id || "")}`;
      if (radioGroupsSeen.has(groupKey)) {
        continue;
      }
      radioGroupsSeen.add(groupKey);
      const group = getChoiceGroup(input);
      const anyChecked = group.some((item) => item.checked);
      if (!anyChecked) {
        unresolved.push(getFieldLabel(field) || input.name || "Required choice");
      }
      continue;
    }

    if (!isVisible(field)) {
      continue;
    }

    const value = getElementValue(field);
    if (!hasUserValue(value)) {
      unresolved.push(getFieldLabel(field) || getAttribute(field, "name") || "Required field");
    }
  }

  return uniqueStrings(unresolved);
}

/**
 * Walks all visible form fields in the page (including shadow DOM) and returns
 * a structured list of questions suitable for the LLM resolver.
 *
 * Each entry includes:
 *   label   — human-readable question text
 *   type    — "select" | "radio" | "checkbox" | "text" | "textarea"
 *   options — for selects/radios/checkboxes: the visible option texts
 *   required — whether the field is required
 */
function extractFormQuestions() {
  const questions = [];
  const seenLabels = new Set();
  const radioGroupsSeen = new Set();

  const fields = collectFormFieldsDeep();

  for (const field of fields) {
    if (!isSupportedField(field) || isFileInput(field) || !isVisible(field)) continue;

    const label = getFieldLabel(field) || getAttribute(field, "placeholder") || "";
    if (!label || label.length < 2) continue;

    const normalizedLabel = normalize(label);

    if (field instanceof HTMLSelectElement) {
      if (seenLabels.has(normalizedLabel)) continue;
      seenLabels.add(normalizedLabel);
      const options = Array.from(field.options)
        .map((o) => o.text.trim())
        .filter((t) => t && t !== "—" && t !== "-" && t.length > 0);
      // Skip placeholder-only option
      const realOptions = options.filter((o) => !/^(select|choose|please select|--)/i.test(o));
      if (realOptions.length === 0) continue;
      questions.push({
        label,
        type: "select",
        options: realOptions,
        required: field.required || getAttribute(field, "aria-required") === "true",
      });
      continue;
    }

    if (field instanceof HTMLInputElement) {
      const type = field.type.toLowerCase();

      if (type === "radio") {
        const groupKey = field.name ? `radio:${normalize(field.name)}` : `radio:${normalizedLabel}`;
        if (radioGroupsSeen.has(groupKey)) continue;
        radioGroupsSeen.add(groupKey);

        const group = getChoiceGroup(field);
        const options = group
          .map((el) => getFieldLabel(el) || el.value || "")
          .map((t) => t.trim())
          .filter(Boolean);

        const groupLabel = getLegendLabel(field) || getFieldLabel(field) || label;
        const groupLabelNorm = normalize(groupLabel);
        if (seenLabels.has(groupLabelNorm)) continue;
        seenLabels.add(groupLabelNorm);

        if (options.length === 0) continue;
        questions.push({
          label: groupLabel,
          type: "radio",
          options,
          required: field.required || getAttribute(field, "aria-required") === "true",
        });
        continue;
      }

      if (type === "checkbox") {
        // Treat each checkbox individually (e.g., "countries you can work in")
        if (seenLabels.has(normalizedLabel)) continue;
        seenLabels.add(normalizedLabel);
        questions.push({
          label,
          type: "checkbox",
          required: field.required || getAttribute(field, "aria-required") === "true",
        });
        continue;
      }

      if (type === "text" || type === "number" || type === "") {
        if (seenLabels.has(normalizedLabel)) continue;
        seenLabels.add(normalizedLabel);
        // Skip pure identity fields — rules handle these fine
        if (["first name", "last name", "full name", "email", "phone"].some((s) => normalizedLabel.includes(s))) continue;
        questions.push({
          label,
          type: "text",
          required: field.required || getAttribute(field, "aria-required") === "true",
        });
        continue;
      }
    }

    if (field instanceof HTMLTextAreaElement) {
      if (seenLabels.has(normalizedLabel)) continue;
      seenLabels.add(normalizedLabel);
      // Skip fields that already have rule-based values
      if (["cover letter", "why", "summary", "additional"].some((s) => normalizedLabel.includes(s))) continue;
      questions.push({
        label,
        type: "textarea",
        required: field.required || getAttribute(field, "aria-required") === "true",
      });
      continue;
    }
  }

  // Also capture custom dropdowns (React-Select comboboxes)
  const customTriggers = collectDeepElements("[role='combobox'], [aria-haspopup='listbox']")
    .filter((el) => el instanceof HTMLElement && isVisible(el));

  for (const trigger of customTriggers) {
    const label = getFieldLabel(trigger) || normalize(getAttribute(trigger, "aria-label")) || "";
    if (!label || label.length < 2) continue;
    const normalizedLabel = normalize(label);
    if (seenLabels.has(normalizedLabel)) continue;
    seenLabels.add(normalizedLabel);

    // Try to get options from already-rendered listbox or sibling select
    const container = trigger.closest("[data-field], .field, .application-question, .question, li, div");
    let options = [];
    if (container) {
      const hiddenSelect = container.querySelector("select");
      if (hiddenSelect instanceof HTMLSelectElement) {
        options = Array.from(hiddenSelect.options)
          .map((o) => o.text.trim())
          .filter((t) => t && !/^(select|choose|please select|--)/i.test(t));
      }
    }
    // Try from aria-owns / aria-controls listbox
    if (options.length === 0) {
      const listboxId = getAttribute(trigger, "aria-owns") || getAttribute(trigger, "aria-controls");
      if (listboxId) {
        const listbox = document.getElementById(listboxId);
        if (listbox) {
          options = Array.from(listbox.querySelectorAll("[role='option']"))
            .map((el) => el instanceof HTMLElement ? el.textContent?.trim() || "" : "")
            .filter(Boolean);
        }
      }
    }

    questions.push({
      label,
      type: "select",
      ...(options.length > 0 ? { options } : {}),
      required: getAttribute(trigger, "aria-required") === "true",
    });
  }

  return questions;
}

/** Gets the <legend> text for a radio/checkbox group */
function getLegendLabel(field) {
  const fieldset = field.closest("fieldset");
  if (!fieldset) return "";
  const legend = fieldset.querySelector("legend");
  return legend ? normalize(legend.textContent || "") : "";
}

async function tryResumeUpload(resumeFile, fields) {
  const fileInputs = fields
    .filter((field) => isFileInput(field))
    .filter((field) => !field.hasAttribute("disabled"));

  for (const input of fileInputs) {
    const uploaded = await setFileInput(input, resumeFile).catch(() => false);
    if (uploaded) {
      return true;
    }
  }
  return false;
}

function triggerResumeAttachButtons() {
  const clickedKeys = new Set();
  const clickables = collectDeepElements("button, [role='button'], a")
    .filter((node) => node instanceof HTMLElement);
  let clicked = 0;

  for (const node of clickables) {
    if (!isVisible(node)) {
      continue;
    }
    const text = normalize(readNodeText(node));
    if (!text) {
      continue;
    }
    if (!matchesAny(text, ATTACH_BUTTON_PATTERNS)) {
      continue;
    }
    if (matchesAny(text, BLOCKED_BUTTON_PATTERNS)) {
      continue;
    }
    const key = `${text}:${normalize(getAttribute(node, "aria-label"))}:${normalize(getAttribute(node, "id"))}`;
    if (clickedKeys.has(key)) {
      continue;
    }
    clickedKeys.add(key);
    node.click();
    clicked += 1;
    if (clicked >= 3) {
      break;
    }
  }

  return clicked;
}

function resolveFieldValue(input) {
  const { field, descriptor, defaults, answerLookup, fieldOverrides } = input;
  const combined = descriptor.combined;
  if (!combined) {
    return "";
  }

  const overrideValue = resolveFieldOverride(fieldOverrides, descriptor);
  if (overrideValue) {
    return overrideValue;
  }

  const directTypeValue = resolveDirectValueByInputType(field, descriptor, defaults);
  if (directTypeValue) {
    return directTypeValue;
  }

  // Layer 2: For choice/select fields on clear yes/no questions, derive the
  // answer deterministically from profile booleans before hitting profilePairs.
  // This avoids passing long strings like "Authorized to work in the United States"
  // into setChoiceInput where they get mis-normalised.
  if (isChoiceInput(field) || field instanceof HTMLSelectElement) {
    const ynAnswer = resolveYesNoFromProfile(descriptor, defaults);
    if (ynAnswer) return ynAnswer;
  }

  // Full location string (city + state) for fields that want a single location value
  const cityState = [defaults.city, defaults.state].filter(Boolean).join(", ");
  const cityStateCountry = [defaults.city, defaults.state, defaults.country].filter(Boolean).join(", ");

  const profilePairs = [
    [["first name", "given name", "first_name", "firstname"], defaults.firstName],
    [["last name", "family name", "surname", "last_name", "lastname"], defaults.lastName],
    [["full name", "legal name", "applicant name", "candidate name"], defaults.fullLegalName],
    [["email", "e mail", "email address"], defaults.email],
    [["country code", "dialing code", "dial code", "calling code", "phone code", "phone prefix", "country dial"], phoneDialCode(defaults.country)],
    [["phone", "mobile", "telephone", "phone number"], defaults.phone],
    [["city", "location city", "current city"], defaults.city],
    [["state", "province", "region"], defaults.state],
    // Country: broad set of phrasings including "where do you reside", "country of residence"
    [["country", "nation", "country of residence", "country reside", "where do you reside",
      "reside", "where you live", "where you currently", "country where", "country you live",
      "currently reside", "residing in"], defaults.country],
    // City+state combos — avoid plain "location" (matches "work from a remote location")
    [["current location", "location city", "where are you located", "address city",
      "city and state", "city state", "city where", "where are you based",
      "if located in us", "if us based", "if in the us", "us city", "us state and city"], cityState || defaults.city],
    [["full address", "mailing address"], cityStateCountry],
    [["linkedin"], defaults.linkedinUrl],
    [["github"], defaults.githubUrl],
    [["portfolio", "website", "personal site", "homepage"], defaults.portfolioUrl],
    [["work authorization", "authorized to work", "work permit", "legally authorized",
      "authorization to work", "legal right to work", "right to work",
      "eligible to work", "in the locations you selected", "in the countries"], defaults.workAuthorization],
    [["us citizen", "citizen status", "citizenship"], defaults.usCitizenStatus],
    [["visa", "sponsor", "sponsorship", "work sponsorship", "require visa", "require sponsorship",
      "need sponsorship", "work permit", "permit now or", "permit in the future",
      "immigration status", "visa status"], defaults.requiresVisaSponsorship],
    [["veteran"], defaults.veteranStatus],
    [["disability"], defaults.disabilityStatus],
    [["gender"], defaults.gender],
    [["hispanic", "latino", "latinx", "ethnicity", "race", "racial", "ethnic background"], defaults.ethnicity],
    [["school", "university", "college", "education"], defaults.school],
    [["degree", "major"], defaults.degree],
    [["graduation", "graduated"], defaults.graduationDate],
    [["years of experience", "experience years", "years experience"], defaults.yearsOfExperience],
    [["current company", "employer", "present company", "current employer"], defaults.currentCompany],
    [["current title", "job title", "present title", "current role"], defaults.currentTitle],
  ];

  for (const [patterns, value] of profilePairs) {
    if (value === undefined || value === null || value === "" || !descriptorMatches(descriptor, patterns)) {
      continue;
    }

    if (isChoiceInput(field)) {
      const isBoolLike = typeof value === "boolean"
        || (typeof value === "number" && (value === 0 || value === 1))
        || String(value).toLowerCase() === "true"
        || String(value).toLowerCase() === "false";

      if (isBoolLike) return inferYesNoValue(value);

      const isRadio = field instanceof HTMLInputElement && field.type.toLowerCase() === "radio";
      if (isRadio) {
        // For radio groups: return the value string directly.
        // setChoiceInput searches all options in the group and clicks the matching one.
        return String(value);
      }

      // Checkbox: only check if THIS checkbox's own label semantically matches the value.
      // (prevents "United States" value from checking every country checkbox on the page)
      const ownLabel = normalize(getFieldLabel(field));
      if (ownLabel && semanticChoiceMatch(ownLabel, normalize(String(value)))) {
        return "Yes";
      }
      return "";
    }

    return String(value);
  }

  if (descriptorMatches(descriptor, ["why this role", "why role", "why interested", "interest in this role"])) {
    return answerLookup.whyRole;
  }
  if (descriptorMatches(descriptor, ["why fit", "why are you a fit", "why should we hire", "good fit"])) {
    return answerLookup.whyFit;
  }
  if (descriptorMatches(descriptor, ["anything else", "additional information", "extra information", "comments"])) {
    return answerLookup.anythingElse;
  }
  if (descriptorMatches(descriptor, ["summary", "professional summary", "about you"])) {
    return defaults.tailoredSummary || answerLookup.whyFit || answerLookup.anythingElse;
  }
  if (descriptorMatches(descriptor, ["cover letter", "message", "motivation"])) {
    return answerLookup.whyRole || answerLookup.whyFit || defaults.tailoredSummary || "";
  }
  if (descriptorMatches(descriptor, ["remote", "work remotely"])) {
    const remote = Array.isArray(defaults.workModes)
      ? defaults.workModes.some((mode) => normalize(mode).includes("remote"))
      : false;
    return remote ? "Yes" : "No";
  }

  return "";
}

function resolveFieldOverride(overrides, descriptor) {
  const directKeys = [
    descriptor.label,
    descriptor.legend,
    descriptor.name,
    descriptor.id,
    descriptor.placeholder,
    descriptor.ariaLabel,
  ]
    .map(normalize)
    .filter(Boolean);

  for (const key of directKeys) {
    const value = overrides[key];
    if (value) {
      return value;
    }
  }

  const combined = descriptor.combined;
  if (!combined) {
    return "";
  }

  const overrideEntries = Object.entries(overrides).sort((a, b) => b[0].length - a[0].length);
  for (const [key, value] of overrideEntries) {
    if (!key || !value) {
      continue;
    }
    if (combined.includes(key) || key.includes(combined)) {
      return value;
    }
  }

  return "";
}

/**
 * For questions that clearly map to a profile boolean (work auth, sponsorship,
 * remote preference, citizenship, marketing opt-in, etc.), return "Yes"/"No"
 * deterministically — no LLM or fuzzy matching needed.
 *
 * Called before profilePairs for choice/select inputs so we don't pass long
 * natural-language strings into yes/no option matching.
 */
function resolveYesNoFromProfile(descriptor, defaults) {
  const c = descriptor.combined;
  if (!c) return "";

  // Authorization to work — true when person DOES NOT require sponsorship
  if (anyIn(c, [
    "authorized to work", "legally authorized", "legal right to work", "right to work",
    "eligible to work", "work in the united states", "work in this country",
    "work without restriction", "work authorization status",
    "in the locations you selected", "in the countries you selected",
  ])) {
    return defaults.requiresVisaSponsorship === "Yes" ? "No" : "Yes";
  }

  // Visa / sponsorship requirement — true when person DOES require sponsorship
  if (anyIn(c, [
    "require sponsor", "need sponsor", "visa sponsor", "require.*visa", "work permit",
    "immigration sponsor", "sponsorship required", "will you require",
    "permit now", "permit in the future", "require work authorization",
    "need work authorization", "require authorization",
  ])) {
    return defaults.requiresVisaSponsorship || "No";
  }

  // Remote work preference
  if (anyIn(c, [
    "work remotely", "remote work", "work from home", "working remotely",
    "this role offer remote", "this role.*remote", "open to remote",
    "prefer remote", "work from anywhere", "remote.*position",
  ])) {
    const wantsRemote = Array.isArray(defaults.workModes)
      && defaults.workModes.some((m) => normalize(String(m)).includes("remote"));
    return wantsRemote ? "Yes" : "No";
  }

  // US citizen check
  if (anyIn(c, [
    "us citizen", "united states citizen", "american citizen",
    "citizen of the united", "are you a citizen", "us national",
  ])) {
    const status = normalize(defaults.usCitizenStatus || "");
    const isCitizen = status.includes("citizen") && !status.startsWith("non");
    return isCitizen ? "Yes" : "No";
  }

  // Marketing / communications opt-in — default to No (privacy-safe)
  if (anyIn(c, [
    "whatsapp", "opt in", "opt-in", "marketing email", "newsletter",
    "promotional", "receive messages", "text messages", "sms",
    "communication preference", "contact me", "email updates",
    "receive.*whatsapp", "receive.*sms",
  ])) {
    return defaults.messagingOptIn || "No";
  }

  // "Have you worked here / been employed by [company]?" — default No
  if (anyIn(c, [
    "previously employed", "employed by", "worked at this company",
    "worked here", "former employee", "have you ever worked",
    "work for us before", "previously worked",
  ])) {
    return "No";
  }

  return "";
}

/** Returns true if any of the patterns appears in the combined descriptor string. */
function anyIn(combined, patterns) {
  return patterns.some((p) => combined.includes(normalize(p)));
}

function resolveDirectValueByInputType(field, descriptor, defaults) {
  if (field instanceof HTMLInputElement) {
    const type = field.type.toLowerCase();
    if (type === "email") {
      return defaults.email || "";
    }
    if (type === "tel") {
      return defaults.phone || "";
    }
    if (type === "url") {
      if (descriptorMatches(descriptor, ["linkedin"])) {
        return defaults.linkedinUrl || "";
      }
      if (descriptorMatches(descriptor, ["github"])) {
        return defaults.githubUrl || "";
      }
      return defaults.portfolioUrl || defaults.linkedinUrl || defaults.githubUrl || "";
    }
    // Phone country code / dialing prefix fields
    if (descriptorMatches(descriptor, [
      "country code", "dialing code", "dial code", "calling code",
      "phone code", "phone prefix", "country dial", "international code",
    ])) {
      return phoneDialCode(defaults.country);
    }
  }
  return "";
}

async function applyValue(field, value, descriptor) {
  if (!value) {
    return false;
  }

  if (field instanceof HTMLSelectElement) {
    return setSelectValue(field, value, descriptor);
  }

  if (field instanceof HTMLTextAreaElement) {
    const current = getElementValue(field);
    if (hasUserValue(current)) {
      return false;
    }
    setNativeTextValue(field, value);
    fireInputEvents(field);
    return true;
  }

  if (field instanceof HTMLInputElement) {
    const type = field.type.toLowerCase();
    if (type === "radio" || type === "checkbox") {
      return setChoiceInput(field, value);
    }
    if (type === "file") {
      return false;
    }
    // If this input is a combobox or triggers a custom dropdown, prefer the
    // custom-dropdown path so we click the real option rather than typing text.
    if (isCustomSelectTrigger(field)) {
      return applyCustomSelect(field, value, descriptor);
    }
    const current = getElementValue(field);
    if (hasUserValue(current)) {
      return false;
    }
    setNativeTextValue(field, value);
    fireInputEvents(field);
    return true;
  }

  if (isEditableElement(field)) {
    // If the editable element is a custom-select combobox, use the option-click path.
    if (isCustomSelectTrigger(field)) {
      return applyCustomSelect(field, value, descriptor);
    }
    const current = getElementValue(field);
    if (hasUserValue(current)) {
      return false;
    }
    field.focus();
    field.textContent = value;
    fireInputEvents(field);
    return true;
  }

  return false;
}

/**
 * Returns true when the element is a visible trigger for a custom (non-native)
 * dropdown — e.g. Greenhouse's React-Select comboboxes.
 */
function isCustomSelectTrigger(el) {
  const role = normalize(getAttribute(el, "role"));
  if (role === "combobox" || role === "listbox") return true;
  const ariaHaspopup = normalize(getAttribute(el, "aria-haspopup"));
  if (ariaHaspopup === "listbox" || ariaHaspopup === "true") return true;
  return false;
}

/**
 * Handles Greenhouse-style React-Select and similar custom dropdowns.
 * Strategy:
 *  1. Check if a sibling hidden <select> exists — set it natively first.
 *  2. Open the dropdown by clicking the trigger.
 *  3. Find the [role="option"] that best matches the desired value and click it.
 *  4. Close if nothing matched (press Escape).
 */
async function applyCustomSelect(trigger, value, descriptor) {
  const requested = expandSelectRequest(value, descriptor);

  // 1. Try to set the underlying hidden native <select> first (React may sync from it)
  const container = trigger.closest("[data-field], .field, .application-question, .question, li, div");
  if (container) {
    const hiddenSelect = container.querySelector("select");
    if (hiddenSelect instanceof HTMLSelectElement) {
      const nativeFilled = setSelectValue(hiddenSelect, value, descriptor);
      if (nativeFilled) {
        // Also fire change on the trigger so the React layer re-renders
        fireInputEvents(trigger);
        return true;
      }
    }
  }

  // 2. Open the dropdown
  trigger.click();
  trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  await delay(120);

  // 3. Find [role="option"] elements now rendered in the DOM
  const options = collectDeepElements("[role='option'], [role='menuitem'], [class*='option']")
    .filter((el) => el instanceof HTMLElement && isVisible(el));

  let bestMatch = null;
  let bestScore = 0;

  for (const opt of options) {
    const text = normalize(readNodeText(opt));
    const val  = normalize(getAttribute(opt, "data-value") || getAttribute(opt, "value") || "");
    let score  = 0;

    for (const req of requested) {
      if (!req || req.length < 2) continue;
      if (text === req || val === req) { score = 100; break; }
      if (text.includes(req) && req.length >= 3) score = Math.max(score, 60);
      if (req.includes(text) && text.length >= 3) score = Math.max(score, 50);
      if (val.includes(req) && req.length >= 3)  score = Math.max(score, 40);
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = opt;
    }
  }

  if (bestMatch && bestScore >= 40) {
    bestMatch.click();
    await delay(60);
    return true;
  }

  // 4. No match — close the dropdown and give up
  trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await delay(60);
  return false;
}

function setNativeTextValue(field, value) {
  if (field instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) {
      setter.call(field, value);
    } else {
      field.value = value;
    }
    return;
  }

  if (field instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (setter) {
      setter.call(field, value);
    } else {
      field.value = value;
    }
  }
}

async function setFileInput(field, resumeFile) {
  if (!(field instanceof HTMLInputElement) || field.type.toLowerCase() !== "file") {
    return false;
  }
  if (!resumeFile.base64) {
    return false;
  }

  const bytes = base64ToUint8Array(resumeFile.base64);
  const file = new File([bytes], resumeFile.name || "resume", {
    type: resumeFile.mimeType || "application/octet-stream",
  });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  field.files = transfer.files;
  fireInputEvents(field);
  return Boolean(field.files && field.files.length > 0);
}

function setSelectValue(field, value, descriptor) {
  const options = Array.from(field.options);
  if (options.length === 0) {
    return false;
  }

  const requested = expandSelectRequest(value, descriptor);
  const exact = options.find((option) => optionMatches(option, requested, true));
  const loose = options.find((option) => optionMatches(option, requested, false));
  const match = exact || loose;
  if (!match || !match.value) {
    return false;
  }
  if (field.value === match.value) {
    return false;
  }

  field.value = match.value;
  fireInputEvents(field);
  return true;
}

function expandSelectRequest(value, descriptor) {
  const requested = normalize(value);
  const expanded = new Set([requested]);
  if (!requested) {
    return expanded;
  }

  if (requested === "yes") {
    ["yes", "true", "y", "1"].forEach((item) => expanded.add(item));
  } else if (requested === "no") {
    ["no", "false", "n", "0"].forEach((item) => expanded.add(item));
  }

  // Country name synonyms — no descriptor check needed; always expand
  if (["united states", "us", "usa", "u s a", "america"].some((s) => requested === s || requested.includes(s))) {
    ["us", "usa", "u s a", "united states", "united states of america", "america"].forEach((item) => expanded.add(normalize(item)));
  }
  if (["united kingdom", "uk", "gb", "great britain", "england"].some((s) => requested === s || requested.includes(s))) {
    ["uk", "gb", "united kingdom", "great britain"].forEach((item) => expanded.add(normalize(item)));
  }
  if (["canada", "ca"].some((s) => requested === s)) {
    ["canada", "ca"].forEach((item) => expanded.add(normalize(item)));
  }

  // State name → abbreviation
  const stateAbbr = STATE_ABBREVIATIONS[requested];
  if (stateAbbr) {
    expanded.add(normalize(stateAbbr));
  }
  // Abbreviation → state name (reverse lookup)
  const stateName = Object.entries(STATE_ABBREVIATIONS).find(([, abbr]) => normalize(abbr) === requested)?.[0];
  if (stateName) {
    expanded.add(stateName);
  }

  // Citizenship / work auth variations
  if (requested === "u s citizen" || requested === "us citizen" || requested.includes("citizen")) {
    ["yes", "u s citizen", "us citizen", "citizen", "united states citizen"].forEach((item) => expanded.add(normalize(item)));
  }
  if (requested.includes("authorized") || requested.includes("authorization")) {
    ["authorized", "authorized to work", "yes i am authorized", "yes"].forEach((item) => expanded.add(normalize(item)));
  }

  // Phone dialing codes
  if (requested === "+1" || requested === "1") {
    ["+1", "1", "us 1", "united states 1"].forEach((item) => expanded.add(normalize(item)));
  }

  return expanded;
}

// US state name → abbreviation map for select matching
const STATE_ABBREVIATIONS = {
  "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
  "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
  "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID",
  "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
  "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
  "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
  "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK",
  "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT",
  "vermont": "VT", "virginia": "VA", "washington": "WA", "west virginia": "WV",
  "wisconsin": "WI", "wyoming": "WY", "district of columbia": "DC",
};

function optionMatches(option, requestedSet, exact) {
  const optionText = normalize(option.text);
  const optionValue = normalize(option.value);
  if (!optionText && !optionValue) {
    return false;
  }

  for (const requested of requestedSet) {
    if (!requested) {
      continue;
    }
    if (exact) {
      if (optionText === requested || optionValue === requested) {
        return true;
      }
      continue;
    }
    // Require minimum length of 3 on the shorter side to prevent spurious
    // substring matches (e.g. "in" matching inside "united states").
    const minLen = 3;
    if (optionText.includes(requested) && requested.length >= minLen) return true;
    if (requested.includes(optionText) && optionText.length >= minLen) return true;
    if (optionValue.includes(requested) && requested.length >= minLen) return true;
    if (requested.includes(optionValue) && optionValue.length >= minLen) return true;
  }

  return false;
}

function setChoiceInput(field, value) {
  const desired = normalizeChoice(value);
  if (!desired) {
    return false;
  }

  const group = getChoiceGroup(field);
  for (const candidate of group) {
    const optionText = normalize(getOptionLabelText(candidate));
    if (!optionText) {
      continue;
    }

    if (matchesChoice(optionText, desired)) {
      if (!candidate.checked) {
        candidate.click();
        fireInputEvents(candidate);
        return true;
      }
      return false;
    }
  }

  if (field.type.toLowerCase() === "checkbox") {
    const shouldCheck = desired === "yes";
    if (field.checked !== shouldCheck) {
      field.click();
      fireInputEvents(field);
      return true;
    }
  }

  return false;
}

function getChoiceGroup(field) {
  if (!(field instanceof HTMLInputElement)) {
    return [];
  }

  if (field.name) {
    const sameName = collectDeepElements(`input[name="${cssEscape(field.name)}"]`)
      .filter((item) => item instanceof HTMLInputElement);
    if (sameName.length > 0) {
      return sameName;
    }
  }

  const scope = field.closest("fieldset, .field, .form-group, .application-question, .question");
  if (!scope) {
    return [field];
  }

  return Array.from(scope.querySelectorAll("input[type='radio'], input[type='checkbox']"));
}

function getOptionLabelText(input) {
  if (!(input instanceof HTMLInputElement)) {
    return "";
  }

  const parts = [];

  if (input.labels && input.labels.length > 0) {
    for (const label of Array.from(input.labels)) {
      parts.push(readNodeText(label));
    }
  }

  const aria = input.getAttribute("aria-label");
  if (aria) {
    parts.push(aria);
  }

  if (input.id) {
    const linked = collectDeepElements(`label[for="${cssEscape(input.id)}"]`);
    for (const labelNode of linked) {
      parts.push(readNodeText(labelNode));
    }
  }

  const parentLabel = input.closest("label");
  if (parentLabel) {
    parts.push(readNodeText(parentLabel));
  }

  if (input.value) {
    parts.push(input.value);
  }

  return parts.join(" ");
}

function describeField(field) {
  const name = getAttribute(field, "name");
  const id = getAttribute(field, "id");
  const placeholder = getAttribute(field, "placeholder");
  const ariaLabel = getAttribute(field, "aria-label");
  const autocomplete = getAttribute(field, "autocomplete");
  const dataTestId = getAttribute(field, "data-testid");
  const dataQa = getAttribute(field, "data-qa");
  const dataTest = getAttribute(field, "data-test");
  const legend = readLegendText(field);
  const labels = readAssociatedLabelTexts(field);
  const prompt = readNearestPromptText(field);

  const tokens = uniqueStrings([
    ...labels,
    prompt,
    legend,
    name,
    id,
    placeholder,
    ariaLabel,
    autocomplete,
    dataTestId,
    dataQa,
    dataTest,
  ].map((item) => normalize(item)));

  return {
    label: labels.length > 0 ? normalize(labels[0]) : "",
    legend: normalize(legend),
    name: normalize(name),
    id: normalize(id),
    placeholder: normalize(placeholder),
    ariaLabel: normalize(ariaLabel),
    autocomplete: normalize(autocomplete),
    tokens,
    combined: tokens.join(" "),
  };
}

function readAssociatedLabelTexts(field) {
  const texts = [];

  if ((field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) && field.labels) {
    for (const label of Array.from(field.labels)) {
      const text = readNodeText(label);
      if (text) {
        texts.push(text);
      }
    }
  }

  const id = getAttribute(field, "id");
  if (id) {
    const linked = collectDeepElements(`label[for="${cssEscape(id)}"]`);
    for (const labelNode of linked) {
      const text = readNodeText(labelNode);
      if (text) {
        texts.push(text);
      }
    }
  }

  const parentLabel = field.closest("label");
  if (parentLabel) {
    const text = readNodeText(parentLabel);
    if (text) {
      texts.push(text);
    }
  }

  const ariaLabelledBy = getAttribute(field, "aria-labelledby");
  if (ariaLabelledBy) {
    for (const part of ariaLabelledBy.split(/\s+/g)) {
      const idNode = findByIdDeep(part.trim());
      if (idNode) {
        const text = readNodeText(idNode);
        if (text) {
          texts.push(text);
        }
      }
    }
  }

  return uniqueStrings(texts);
}

function readLegendText(field) {
  const legend = field.closest("fieldset")?.querySelector("legend");
  return legend ? readNodeText(legend) : "";
}

function readNearestPromptText(field) {
  const section = field.closest(".field, .form-group, .application-question, .question, li, div");
  if (!section) {
    return "";
  }
  const prompt = section.querySelector("label, legend, h1, h2, h3, h4, p, span");
  if (!prompt) {
    return "";
  }
  return readNodeText(prompt);
}

function descriptorMatches(descriptor, patterns) {
  const tokens = descriptor.tokens || [];
  const normalizedPatterns = patterns.map((pattern) => normalize(pattern)).filter(Boolean);
  if (tokens.length === 0 || normalizedPatterns.length === 0) {
    return false;
  }

  return normalizedPatterns.some((pattern) =>
    tokens.some((token) => token.includes(pattern) || pattern.includes(token)));
}

function getFieldLabel(field) {
  const descriptor = describeField(field);
  return descriptor.label || descriptor.legend || descriptor.placeholder || descriptor.name || descriptor.id || "";
}

function normalizeOverrideMap(rawOverrides) {
  if (!rawOverrides || typeof rawOverrides !== "object") {
    return {};
  }
  const normalized = {};
  for (const [key, value] of Object.entries(rawOverrides)) {
    const normalizedKey = normalize(key);
    const normalizedValue = typeof value === "string" ? value.trim() : "";
    if (!normalizedKey || !normalizedValue) {
      continue;
    }
    normalized[normalizedKey] = normalizedValue;
  }
  return normalized;
}

function isSupportedField(node) {
  return node instanceof HTMLInputElement
    || node instanceof HTMLTextAreaElement
    || node instanceof HTMLSelectElement
    || isEditableElement(node);
}

function isUsableField(field) {
  if (!(field instanceof HTMLElement)) {
    return false;
  }

  if (field.hasAttribute("disabled")) {
    return false;
  }
  // React-Select and similar custom dropdowns render readonly inputs to prevent
  // free-text typing, but the input must still receive clicks for option selection.
  if (field.hasAttribute("readonly") && !isCustomSelectTrigger(field)) {
    return false;
  }

  if (field instanceof HTMLInputElement) {
    const type = field.type.toLowerCase();
    if (["hidden", "submit", "button", "image", "reset"].includes(type)) {
      return false;
    }
    if (type === "file") {
      return !field.hasAttribute("disabled");
    }
  }

  return isVisible(field);
}

function isVisible(element) {
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }
  if (element.getClientRects().length > 0) {
    return true;
  }
  return style.position === "fixed";
}

function isEditableElement(node) {
  return node instanceof HTMLElement && (node.isContentEditable || normalize(getAttribute(node, "role")) === "textbox");
}

function isFileInput(field) {
  return field instanceof HTMLInputElement && field.type.toLowerCase() === "file";
}

function isChoiceInput(field) {
  return field instanceof HTMLInputElement
    && ["radio", "checkbox"].includes(field.type.toLowerCase());
}

function getElementValue(field) {
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) {
    return String(field.value || "");
  }
  if (isEditableElement(field)) {
    return field.textContent || "";
  }
  return "";
}

function buildAnswerLookup(generatedAnswers, defaults) {
  const lookup = {
    whyRole: defaults.whyRole || "",
    whyFit: defaults.whyFit || "",
    anythingElse: defaults.anythingElse || "",
  };

  for (const item of generatedAnswers) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const kind = normalize(item.kind || "");
    const answer = typeof item.answer === "string" ? item.answer.trim() : "";
    if (!answer) {
      continue;
    }
    if (kind === "why role" || kind === "why_role") {
      lookup.whyRole = answer;
    } else if (kind === "why fit" || kind === "why_fit") {
      lookup.whyFit = answer;
    } else if (kind === "anything else" || kind === "anything_else") {
      lookup.anythingElse = answer;
    }
  }

  return lookup;
}

function inferYesNoValue(value) {
  const normalized = normalize(String(value || ""));
  if (
    normalized.includes("no")
    || normalized.includes("not")
    || normalized.includes("without sponsorship")
    || normalized.includes("decline")
    || normalized === "false"
    || normalized === "0"
  ) {
    return "No";
  }
  return "Yes";
}

function normalizeChoice(value) {
  const normalized = normalize(String(value || ""));
  if (!normalized) {
    return "";
  }
  if (["y", "yes", "true", "1"].includes(normalized)) {
    return "yes";
  }
  if (["n", "no", "false", "0"].includes(normalized)) {
    return "no";
  }
  if (normalized.includes("not")) {
    return "no";
  }
  return normalized;
}

function matchesChoice(optionText, desired) {
  if (!optionText || !desired) {
    return false;
  }

  // Determine whether the option text is semantically positive or negative.
  // Negative = contains a negation word that flips the meaning.
  const hasNegation = /\b(not|no|won t|will not|do not|don t|cannot|can t|never|without|decline)\b/.test(optionText);

  if (desired === "yes") {
    // Exact positive labels
    if (optionText === "yes" || optionText === "true" || optionText === "y") return true;
    // Positive phrases without negation language
    if (!hasNegation && matchesAny(optionText, [
      "i do", "i am", "i will", "authorized", "eligible", "i plan",
      "i currently", "i have", "prefer", "yes i", "i agree",
    ])) return true;
    return false;
  }

  if (desired === "no") {
    // Exact negative labels
    if (optionText === "no" || optionText === "false" || optionText === "n") return true;
    // Any option containing negation language is the "No" answer on yes/no questions.
    // e.g. "I am not a protected veteran", "I will not require sponsorship",
    //      "I do not require a work permit", "Decline to state"
    if (hasNegation) return true;
    return false;
  }

  // Non-boolean desired: substring match with minimum length guard
  const normalizedOption = normalize(optionText);
  const minLen = 3;
  return (normalizedOption.includes(desired) && desired.length >= minLen)
    || (desired.includes(normalizedOption) && normalizedOption.length >= minLen);
}

function fireInputEvents(element) {
  element.dispatchEvent(new Event("focus", { bubbles: true, composed: true }));
  try {
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      composed: true,
      inputType: "insertText",
      data: "",
    }));
  } catch {
    element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  }
  element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  element.dispatchEvent(new Event("blur", { bubbles: true, composed: true }));
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function collectDeepElements(selector) {
  const roots = collectOpenRoots();
  const elements = [];
  for (const root of roots) {
    if (!root || typeof root.querySelectorAll !== "function") {
      continue;
    }
    for (const match of Array.from(root.querySelectorAll(selector))) {
      elements.push(match);
    }
  }
  return uniqueElements(elements);
}

function collectOpenRoots() {
  const roots = [];
  const queue = [document];
  const seen = new Set();

  while (queue.length > 0) {
    const root = queue.shift();
    if (!root || seen.has(root)) {
      continue;
    }
    seen.add(root);
    roots.push(root);

    if (typeof root.querySelectorAll !== "function") {
      continue;
    }
    const all = root.querySelectorAll("*");
    for (const node of Array.from(all)) {
      if (node instanceof HTMLElement && node.shadowRoot && !seen.has(node.shadowRoot)) {
        queue.push(node.shadowRoot);
      }
    }
  }

  return roots;
}

function findByIdDeep(id) {
  if (!id) {
    return null;
  }
  const roots = collectOpenRoots();
  for (const root of roots) {
    if (typeof root.querySelector !== "function") {
      continue;
    }
    const node = root.querySelector(`#${cssEscape(id)}`);
    if (node) {
      return node;
    }
  }
  return null;
}

function hasUserValue(value) {
  return String(value || "").trim().length > 0;
}

function uniqueElements(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    if (!value || typeof value !== "object") {
      continue;
    }
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    output.push(value);
  }
  return output;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}

function readNodeText(node) {
  return String(node?.textContent || "").replace(/\s+/g, " ").trim();
}

function matchesAny(value, candidates) {
  const normalizedValue = normalize(value);
  return candidates.some((candidate) => normalizedValue.includes(normalize(candidate)));
}

function getAttribute(node, name) {
  return node && typeof node.getAttribute === "function" ? node.getAttribute(name) || "" : "";
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(value);
  }
  return String(value).replace(/["\\]/g, "\\$&");
}

/**
 * Returns true when a checkbox/radio option label semantically represents the
 * given value.  Used to avoid the "all checkboxes checked" bug where
 * inferYesNoValue("United States") = "Yes" was applied to every country checkbox.
 */
function semanticChoiceMatch(optionLabel, value) {
  if (!optionLabel || !value) return false;

  // Exact or simple substring
  if (optionLabel === value) return true;
  if (optionLabel.includes(value) && value.length > 3) return true;
  if (value.includes(optionLabel) && optionLabel.length > 3) return true;

  // Country synonym groups — a "US" checkbox should match value "united states"
  const synonymGroups = [
    ["united states", "united states of america", "usa", "us", "u s a", "america"],
    ["united kingdom", "uk", "great britain", "gb", "england"],
    ["canada", "ca"],
    ["australia", "au"],
    ["germany", "de", "deutschland"],
    ["france", "fr"],
    ["india", "in"],
  ];
  for (const group of synonymGroups) {
    const labelInGroup = group.some((s) => optionLabel === s || (s.length > 2 && optionLabel.includes(s)));
    const valueInGroup = group.some((s) => value === s || (s.length > 2 && value.includes(s)));
    if (labelInGroup && valueInGroup) return true;
  }

  // Work authorization: "authorized" label matches "authorized to work in the united states" value
  if (value.includes("authorized") && optionLabel.includes("authorized")) return true;

  return false;
}

/** Returns the E.164 dialing prefix for a country string, defaulting to +1. */
function phoneDialCode(country) {
  const c = normalize(String(country || ""));
  if (c.includes("united states") || c.includes("usa") || c === "us" || c.includes("canada")) return "+1";
  if (c.includes("united kingdom") || c === "gb" || c === "uk") return "+44";
  if (c.includes("australia") || c === "au") return "+61";
  if (c.includes("india") || c === "in") return "+91";
  if (c.includes("germany") || c === "de") return "+49";
  if (c.includes("france") || c === "fr") return "+33";
  return "+1"; // default
}

function tryClickSubmit() {
  const SUBMIT_PATTERNS = ["submit application", "submit", "apply now", "apply", "send application"];
  const SKIP_PATTERNS   = ["save", "back", "cancel", "previous", "upload", "attach", "next", "continue"];

  const clickables = collectDeepElements("button[type='submit'], button, input[type='submit'], [role='button']")
    .filter((node) => node instanceof HTMLElement && isVisible(node));

  for (const node of clickables) {
    const text = normalize(readNodeText(node));
    if (!text) continue;
    if (matchesAny(text, SKIP_PATTERNS)) continue;
    if (!matchesAny(text, SUBMIT_PATTERNS)) continue;

    // Confirm at least one required field looks filled before submitting
    const unresolved = collectUnresolvedRequiredFieldsDeep();
    if (unresolved.length > 0) return false;

    node.click();
    return true;
  }

  return false;
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
