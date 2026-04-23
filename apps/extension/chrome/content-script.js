const AUTO_FILL_FLAG_PREFIX = "jobhunter_autofill_done_";

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
  const fields = collectFormFields();
  const detectedFieldCount = fields.length;
  let filledFieldCount = 0;
  let usableFieldCount = 0;
  let resumeUploaded = false;

  for (const field of fields) {
    if (!isUsableField(field)) {
      continue;
    }
    usableFieldCount += 1;

    if (field instanceof HTMLInputElement && field.type.toLowerCase() === "file") {
      if (resumeFile && !resumeUploaded) {
        const uploaded = await setFileInput(field, resumeFile).catch(() => false);
        if (uploaded) {
          resumeUploaded = true;
          filledFieldCount += 1;
        }
      }
      continue;
    }

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

    const changed = applyValue(field, value);
    if (changed) {
      filledFieldCount += 1;
    }
  }

  const unresolvedRequired = collectUnresolvedRequiredFields();
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

function collectFormFields() {
  const selectors = [
    "input",
    "textarea",
    "select",
    "[contenteditable='true']",
    "[contenteditable='']",
  ];
  return Array.from(document.querySelectorAll(selectors.join(", ")));
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

  const directTypeValue = resolveDirectValueByInputType(field, defaults);
  if (directTypeValue && descriptorLooksGeneric(descriptor)) {
    return directTypeValue;
  }

  const profilePairs = [
    [["first name", "given name", "first_name"], defaults.firstName],
    [["last name", "family name", "surname", "last_name"], defaults.lastName],
    [["full name", "legal name", "applicant name"], defaults.fullLegalName],
    [["email", "e-mail"], defaults.email],
    [["phone", "mobile", "telephone"], defaults.phone],
    [["city", "location city", "current city"], defaults.city],
    [["state", "province", "region"], defaults.state],
    [["country", "nation"], defaults.country],
    [["linkedin"], defaults.linkedinUrl],
    [["github"], defaults.githubUrl],
    [["portfolio", "website", "personal site"], defaults.portfolioUrl],
    [["work authorization", "authorized to work", "work permit"], defaults.workAuthorization],
    [["us citizen", "citizen status", "citizenship"], defaults.usCitizenStatus],
    [["visa", "sponsor", "sponsorship"], defaults.requiresVisaSponsorship],
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
    if (!value || !matchesAny(combined, patterns)) {
      continue;
    }
    if (field instanceof HTMLInputElement && (field.type === "radio" || field.type === "checkbox")) {
      return inferYesNoValue(value);
    }
    return String(value);
  }

  if (matchesAny(combined, ["why this role", "why role", "why interested", "interest in this role"])) {
    return answerLookup.whyRole;
  }
  if (matchesAny(combined, ["why fit", "why are you a fit", "why should we hire", "good fit"])) {
    return answerLookup.whyFit;
  }
  if (matchesAny(combined, ["anything else", "additional information", "extra information", "comments"])) {
    return answerLookup.anythingElse;
  }
  if (matchesAny(combined, ["summary", "professional summary"])) {
    return defaults.tailoredSummary || answerLookup.whyFit;
  }
  if (matchesAny(combined, ["remote", "work remotely"])) {
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

function resolveDirectValueByInputType(field, defaults) {
  if (!(field instanceof HTMLInputElement)) {
    return "";
  }

  const type = field.type.toLowerCase();
  if (type === "email") {
    return defaults.email || "";
  }
  if (type === "tel") {
    return defaults.phone || "";
  }
  if (type === "url") {
    const descriptor = describeField(field);
    if (descriptor.combined.includes("linkedin")) {
      return defaults.linkedinUrl || "";
    }
    if (descriptor.combined.includes("github")) {
      return defaults.githubUrl || "";
    }
    return defaults.portfolioUrl || defaults.linkedinUrl || "";
  }
  return "";
}

function descriptorLooksGeneric(descriptor) {
  const combined = descriptor.combined;
  return combined === "email" || combined === "phone" || combined === "mobile" || combined === "telephone";
}

function applyValue(field, value) {
  if (!value) {
    return false;
  }

  if (field instanceof HTMLSelectElement) {
    return setSelectValue(field, value);
  }

  if (field instanceof HTMLTextAreaElement) {
    if (hasUserValue(field.value)) {
      return false;
    }
    field.focus();
    field.value = value;
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
    if (hasUserValue(field.value)) {
      return false;
    }
    field.focus();
    field.value = value;
    fireInputEvents(field);
    return true;
  }

  if (isEditableElement(field)) {
    if (hasUserValue(field.textContent || "")) {
      return false;
    }
    field.focus();
    field.textContent = value;
    fireInputEvents(field);
    return true;
  }

  return false;
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

function setSelectValue(field, value) {
  const normalizedRequested = normalize(value);
  if (!normalizedRequested) {
    return false;
  }

  const options = Array.from(field.options);
  const exact = options.find((option) =>
    normalize(option.text) === normalizedRequested
    || normalize(option.value) === normalizedRequested);
  const loose = options.find((option) =>
    normalize(option.text).includes(normalizedRequested)
    || normalizedRequested.includes(normalize(option.text))
    || normalize(option.value).includes(normalizedRequested)
    || normalizedRequested.includes(normalize(option.value)));
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

function setChoiceInput(field, value) {
  const normalizedDesired = normalizeChoice(value);
  if (!normalizedDesired) {
    return false;
  }

  const groupInputs = getChoiceGroup(field);
  for (const candidate of groupInputs) {
    const optionText = normalize(getOptionLabelText(candidate));
    if (!optionText) {
      continue;
    }
    if (matchesChoice(optionText, normalizedDesired)) {
      if (!candidate.checked) {
        candidate.click();
        fireInputEvents(candidate);
        return true;
      }
      return false;
    }
  }

  if (field.type.toLowerCase() === "checkbox") {
    const shouldCheck = normalizedDesired === "yes";
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
    const escaped = cssEscape(field.name);
    const sameName = Array.from(document.querySelectorAll(`input[name="${escaped}"]`));
    const typed = sameName.filter((item) => item instanceof HTMLInputElement);
    if (typed.length > 0) {
      return typed;
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
      parts.push(label.textContent || "");
    }
  }

  const aria = input.getAttribute("aria-label");
  if (aria) {
    parts.push(aria);
  }

  const linkedLabel = input.id ? document.querySelector(`label[for="${cssEscape(input.id)}"]`) : null;
  if (linkedLabel && linkedLabel.textContent) {
    parts.push(linkedLabel.textContent);
  }

  const parentLabel = input.closest("label");
  if (parentLabel && parentLabel.textContent) {
    parts.push(parentLabel.textContent);
  }

  if (input.value) {
    parts.push(input.value);
  }

  return normalize(parts.join(" "));
}

function collectUnresolvedRequiredFields() {
  const selectors = [
    "input[required]",
    "textarea[required]",
    "select[required]",
    "input[aria-required='true']",
    "textarea[aria-required='true']",
    "select[aria-required='true']",
  ];
  const unresolved = [];
  const requiredFields = Array.from(document.querySelectorAll(selectors.join(", ")));

  for (const field of requiredFields) {
    if (!(field instanceof HTMLElement)) {
      continue;
    }
    if (field instanceof HTMLInputElement && field.type.toLowerCase() === "file") {
      if (!field.files || field.files.length === 0) {
        unresolved.push(getFieldLabel(field) || "Resume upload");
      }
      continue;
    }

    if (field instanceof HTMLInputElement && (field.type.toLowerCase() === "radio" || field.type.toLowerCase() === "checkbox")) {
      const group = field.name
        ? document.querySelectorAll(`input[name="${cssEscape(field.name)}"]`)
        : [field];
      const anyChecked = Array.from(group).some((item) => item instanceof HTMLInputElement && item.checked);
      if (!anyChecked) {
        unresolved.push(getFieldLabel(field) || field.name || "Required choice");
      }
      continue;
    }

    if (!isVisible(field) && !(field instanceof HTMLInputElement && field.type.toLowerCase() === "file")) {
      continue;
    }

    const value = getElementValue(field);
    if (!hasUserValue(value)) {
      unresolved.push(getFieldLabel(field) || field.getAttribute("name") || "Required field");
    }
  }

  return uniqueStrings(unresolved);
}

function getFieldLabel(field) {
  const descriptor = describeField(field);
  return descriptor.label || descriptor.legend || descriptor.placeholder || descriptor.name || descriptor.id || "";
}

function describeField(field) {
  const name = getFieldName(field);
  const id = getFieldId(field);
  const placeholder = getAttribute(field, "placeholder");
  const ariaLabel = getAttribute(field, "aria-label");
  const autocomplete = getAttribute(field, "autocomplete");
  const label = readLabelText(field);
  const legend = readLegendText(field);

  const parts = [label, legend, name, id, placeholder, ariaLabel, autocomplete]
    .map(normalize)
    .filter(Boolean);

  return {
    label: normalize(label),
    legend: normalize(legend),
    name: normalize(name),
    id: normalize(id),
    placeholder: normalize(placeholder),
    ariaLabel: normalize(ariaLabel),
    autocomplete: normalize(autocomplete),
    combined: uniqueStrings(parts).join(" "),
  };
}

function readLabelText(field) {
  const ariaLabel = getAttribute(field, "aria-label");
  if (ariaLabel) {
    return ariaLabel;
  }

  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) {
    if (field.id) {
      const linkedLabel = document.querySelector(`label[for="${cssEscape(field.id)}"]`);
      if (linkedLabel && linkedLabel.textContent) {
        return linkedLabel.textContent.trim();
      }
    }
  }

  const parentLabel = field.closest("label");
  if (parentLabel && parentLabel.textContent) {
    return parentLabel.textContent.trim();
  }

  return "";
}

function readLegendText(field) {
  const legend = field.closest("fieldset")?.querySelector("legend");
  return legend && legend.textContent ? legend.textContent.trim() : "";
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
      return true;
    }
  }

  if (!isVisible(field)) {
    return false;
  }

  return field instanceof HTMLInputElement
    || field instanceof HTMLTextAreaElement
    || field instanceof HTMLSelectElement
    || isEditableElement(field);
}

function isVisible(element) {
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }
  return element.offsetParent !== null || style.position === "fixed";
}

function isEditableElement(node) {
  return node instanceof HTMLElement && node.isContentEditable;
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
  return optionText.includes(desired) || desired.includes(optionText);
}

function fireInputEvents(element) {
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.dispatchEvent(new Event("blur", { bubbles: true }));
}

function hasUserValue(value) {
  return String(value || "").trim().length > 0;
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}

function matchesAny(value, candidates) {
  const normalizedValue = normalize(value);
  return candidates.some((candidate) => normalizedValue.includes(normalize(candidate)));
}

function getFieldName(field) {
  return getAttribute(field, "name");
}

function getFieldId(field) {
  return getAttribute(field, "id");
}

function getAttribute(field, name) {
  return typeof field.getAttribute === "function" ? field.getAttribute(name) || "" : "";
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
