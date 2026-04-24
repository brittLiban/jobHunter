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

    const changed = applyValue(field, value, descriptor);
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

  const profilePairs = [
    [["first name", "given name", "first_name", "firstname"], defaults.firstName],
    [["last name", "family name", "surname", "last_name", "lastname"], defaults.lastName],
    [["full name", "legal name", "applicant name", "candidate name"], defaults.fullLegalName],
    [["email", "e mail", "email address"], defaults.email],
    [["phone", "mobile", "telephone", "phone number"], defaults.phone],
    [["city", "location city", "current city"], defaults.city],
    [["state", "province", "region"], defaults.state],
    [["country", "nation"], defaults.country],
    [["linkedin"], defaults.linkedinUrl],
    [["github"], defaults.githubUrl],
    [["portfolio", "website", "personal site", "homepage"], defaults.portfolioUrl],
    [["work authorization", "authorized to work", "work permit"], defaults.workAuthorization],
    [["us citizen", "citizen status", "citizenship"], defaults.usCitizenStatus],
    [["visa", "sponsor", "sponsorship", "work sponsorship"], defaults.requiresVisaSponsorship],
    [["veteran"], defaults.veteranStatus],
    [["disability"], defaults.disabilityStatus],
    [["school", "university", "college", "education"], defaults.school],
    [["degree", "major"], defaults.degree],
    [["graduation", "graduated"], defaults.graduationDate],
    [["years of experience", "experience years"], defaults.yearsOfExperience],
    [["current company", "employer", "present company"], defaults.currentCompany],
    [["current title", "job title", "present title"], defaults.currentTitle],
  ];

  for (const [patterns, value] of profilePairs) {
    if (!value || !descriptorMatches(descriptor, patterns)) {
      continue;
    }
    if (isChoiceInput(field)) {
      return inferYesNoValue(value);
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
  }
  return "";
}

function applyValue(field, value, descriptor) {
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
    const current = getElementValue(field);
    if (hasUserValue(current)) {
      return false;
    }
    setNativeTextValue(field, value);
    fireInputEvents(field);
    return true;
  }

  if (isEditableElement(field)) {
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

  if (descriptorMatches(descriptor, ["country"]) && requested.includes("united states")) {
    ["us", "usa", "united states", "united states of america"].forEach((item) => expanded.add(normalize(item)));
  }

  if (requested === "u s citizen" || requested === "us citizen" || requested.includes("citizen")) {
    ["yes", "u s citizen", "us citizen", "citizen"].forEach((item) => expanded.add(normalize(item)));
  }

  return expanded;
}

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
    if (
      optionText.includes(requested)
      || requested.includes(optionText)
      || optionValue.includes(requested)
      || requested.includes(optionValue)
    ) {
      return true;
    }
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

  if (field.hasAttribute("disabled") || field.hasAttribute("readonly")) {
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

  if (desired === "yes") {
    return matchesAny(optionText, ["yes", "true", "i do", "authorized", "eligible"]);
  }
  if (desired === "no") {
    return matchesAny(optionText, ["no", "false", "i do not", "not authorized", "not eligible"]);
  }

  const normalizedOption = normalize(optionText);
  return normalizedOption.includes(desired) || desired.includes(normalizedOption);
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
