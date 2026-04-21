import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { GeneratedAnswer, StructuredApplicationDefaults } from "@jobhunter/core";
import { applicationCheckpointSchema } from "@jobhunter/core";
import type { Page } from "playwright";
import { chromium } from "playwright";

import { detectCheckpointFromText } from "./checkpoints";
import { resolveStructuredValue, detectManualActionType, normalizeLabel } from "./field-mapping";
import type { ApplyResult } from "./result";

const SUBMIT_SUCCESS = /(thank you|application submitted|application received|we ll be in touch|successfully submitted)/i;
const SUBMIT_ERROR = /(please fix|field is required|invalid|error)/i;

export async function applyToGreenhouseJob(input: {
  jobUrl: string;
  defaults: StructuredApplicationDefaults;
  resumePath: string;
  generatedAnswers: GeneratedAnswer[];
  applicationId: string;
  dryRun?: boolean;
}): Promise<ApplyResult> {
  const applyUrl = deriveGreenhouseApplyUrl(input.jobUrl);
  const preparedPayload = {
    applyUrl,
    defaults: input.defaults,
    generatedAnswers: input.generatedAnswers,
    resumePath: input.resumePath,
  };
  const filledFields: string[] = [];
  const unknownRequiredFields: string[] = [];
  const missingProfileFields: string[] = [];

  const browser = await chromium.launch({
    headless: process.env.PLAYWRIGHT_HEADLESS !== "false",
  });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(applyUrl, { waitUntil: "networkidle" });

    await fillCommonFields(page, input.defaults, filledFields);
    await uploadResume(page, input.resumePath, filledFields);
    await fillKnownRequiredFields(page, input.defaults, input.generatedAnswers, filledFields, unknownRequiredFields, missingProfileFields);

    const pageText = await page.locator("body").innerText().catch(() => "");
    const checkpoint = detectCheckpointFromText(pageText);
    const detectedManualAction = detectManualActionType(pageText);
    if (checkpoint || detectedManualAction) {
      const artifacts = await captureCheckpointArtifacts(page, input.applicationId, pageText);
      const typedCheckpoint = applicationCheckpointSchema.parse({
        manualActionType: checkpoint?.manualActionType ?? detectedManualAction ?? "security_verification",
        reason: checkpoint?.reason ?? "Manual verification or anti-bot protection was detected.",
        currentUrl: page.url(),
        preparedFields: {},
      });
      return {
        success: false,
        submitted: false,
        dryRun: Boolean(input.dryRun),
        source: "greenhouse",
        applyUrl,
        checkpoint: typedCheckpoint,
        manualActionType: typedCheckpoint.manualActionType,
        blockingReason: typedCheckpoint.reason,
        filledFields,
        unknownRequiredFields,
        missingProfileFields,
        preparedPayload,
        checkpointArtifacts: artifacts,
        currentUrl: page.url(),
      };
    }

    if (unknownRequiredFields.length > 0 || missingProfileFields.length > 0) {
      const artifacts = await captureCheckpointArtifacts(page, input.applicationId, pageText);
      return {
        success: false,
        submitted: false,
        dryRun: Boolean(input.dryRun),
        source: "greenhouse",
        applyUrl,
        checkpoint: {
          manualActionType: "missing_required_info",
          reason: "Required fields remain unresolved after structured autofill.",
          currentUrl: page.url(),
          preparedFields: {},
        },
        manualActionType: "missing_required_info",
        blockingReason: "Required fields remain unresolved after structured autofill.",
        filledFields,
        unknownRequiredFields,
        missingProfileFields,
        preparedPayload,
        checkpointArtifacts: artifacts,
        currentUrl: page.url(),
      };
    }

    if (input.dryRun) {
      return {
        success: true,
        submitted: false,
        dryRun: true,
        source: "greenhouse",
        applyUrl,
        filledFields,
        unknownRequiredFields,
        missingProfileFields,
        preparedPayload,
        currentUrl: page.url(),
      };
    }

    const submitButton = page.getByRole("button", { name: /submit application/i }).first();
    if (!(await submitButton.count())) {
      const artifacts = await captureCheckpointArtifacts(page, input.applicationId, pageText);
      return {
        success: false,
        submitted: false,
        dryRun: false,
        source: "greenhouse",
        applyUrl,
        checkpoint: {
          manualActionType: "ambiguous_submit_state",
          reason: "Submit button was not found on the application page.",
          currentUrl: page.url(),
          preparedFields: {},
        },
        manualActionType: "ambiguous_submit_state",
        blockingReason: "Submit button was not found on the application page.",
        filledFields,
        unknownRequiredFields,
        missingProfileFields,
        preparedPayload,
        checkpointArtifacts: artifacts,
        currentUrl: page.url(),
      };
    }

    await submitButton.click();
    const confirmationText = await waitForSubmissionConfirmation(page);
    return {
      success: true,
      submitted: true,
      dryRun: false,
      source: "greenhouse",
      applyUrl,
      confirmationText,
      filledFields,
      unknownRequiredFields,
      missingProfileFields,
      preparedPayload,
      currentUrl: page.url(),
    };
  } catch (error) {
    return {
      success: false,
      submitted: false,
      dryRun: Boolean(input.dryRun),
      source: "greenhouse",
      applyUrl,
      error: error instanceof Error ? error.message : "Greenhouse apply failed.",
      blockingReason: "Unknown application structure or runtime failure interrupted the flow.",
      manualActionType: "unknown_form_structure",
      filledFields,
      unknownRequiredFields,
      missingProfileFields,
      preparedPayload,
    };
  } finally {
    await browser.close();
  }
}

export function deriveGreenhouseApplyUrl(jobUrl: string): string {
  if (jobUrl.includes("/jobs/")) {
    return jobUrl.replace("/jobs/", "/apply/");
  }
  if (jobUrl.includes("/apply/")) {
    return jobUrl;
  }
  return jobUrl;
}

async function fillCommonFields(page: Page, defaults: StructuredApplicationDefaults, filledFields: string[]) {
  const exactMappings: Array<[string, string]> = [
    ["First Name", defaults.firstName],
    ["Last Name", defaults.lastName],
    ["Email", defaults.email],
    ["Phone", defaults.phone],
  ];

  for (const [label, value] of exactMappings) {
    if (!value) {
      continue;
    }
    if (await labelExists(page, label)) {
      await fillTextField(page, label, value);
      filledFields.push(label);
    }
  }
}

async function uploadResume(page: Page, resumePath: string, filledFields: string[]) {
  const candidates = [
    'input[type="file"]#resume',
    'input[type="file"][name*="resume"]',
    'input[type="file"][id*="resume"]',
  ];
  for (const selector of candidates) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      await locator.setInputFiles(resumePath);
      filledFields.push("Resume");
      return;
    }
  }
}

async function fillKnownRequiredFields(
  page: Page,
  defaults: StructuredApplicationDefaults,
  generatedAnswers: GeneratedAnswer[],
  filledFields: string[],
  unknownRequiredFields: string[],
  missingProfileFields: string[],
) {
  const requiredLabels = await getRequiredPromptTexts(page);
  for (const label of requiredLabels) {
    if (filledFields.some((filled) => normalizeLabel(filled) === label)) {
      continue;
    }

    const displayLabel = await findDisplayLabel(page, label);
    if (!displayLabel) {
      unknownRequiredFields.push(label);
      continue;
    }

    const resolved = resolveStructuredValue(displayLabel, defaults, generatedAnswers);
    if (!resolved.value) {
      if (resolved.missingField) {
        missingProfileFields.push(resolved.missingField);
      } else {
        unknownRequiredFields.push(displayLabel);
      }
      continue;
    }

    const kind = await fieldKind(page, displayLabel);
    if (kind === "select") {
      await selectOption(page, displayLabel, resolved.value);
    } else {
      await fillTextField(page, displayLabel, resolved.value);
    }
    filledFields.push(displayLabel);
  }
}

async function getRequiredPromptTexts(page: Page) {
  const values = new Set<string>();
  for (const selector of ["label", "legend"]) {
    const locator = page.locator(selector);
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const text = (await locator.nth(index).innerText()).trim();
      if (!text.includes("*")) {
        continue;
      }
      values.add(normalizeLabel(text.replaceAll("*", "")));
    }
  }
  return [...values];
}

async function captureCheckpointArtifacts(page: Page, applicationId: string, pageText: string) {
  const directory = resolve("data", "manual_checkpoints", applicationId);
  await mkdir(directory, { recursive: true });
  const screenshotPath = join(directory, "checkpoint.png");
  const htmlPath = join(directory, "checkpoint.html");
  const textPath = join(directory, "checkpoint.txt");

  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  await writeFile(htmlPath, await page.content(), "utf8").catch(() => undefined);
  await writeFile(textPath, pageText, "utf8").catch(() => undefined);

  return {
    screenshotPath,
    htmlPath,
    textPath,
  };
}

async function waitForSubmissionConfirmation(page: Page) {
  const originalUrl = page.url();
  await page.waitForTimeout(1200);
  for (let attempts = 0; attempts < 50; attempts += 1) {
    const text = await page.locator("body").innerText().catch(() => "");
    if (SUBMIT_SUCCESS.test(text)) {
      return text.slice(0, 240);
    }
    if (SUBMIT_ERROR.test(text)) {
      throw new Error(`Form validation error after submit: ${text.slice(0, 240)}`);
    }
    if (page.url() !== originalUrl && !page.url().includes("/apply")) {
      return `Redirected to ${page.url()}`;
    }
    await page.waitForTimeout(500);
  }
  throw new Error("Submit button did not transition to a confirmation state.");
}

async function labelExists(page: Page, label: string) {
  return (await findMatchingLabel(page, normalizeLabel(label))) !== null;
}

async function fillTextField(page: Page, labelText: string, value: string) {
  const fieldId = await getFieldId(page, labelText);
  const locator = page.locator(`[id=${JSON.stringify(fieldId)}]`).first();
  await locator.scrollIntoViewIfNeeded();
  await locator.fill(value);
}

async function selectOption(page: Page, labelText: string, value: string) {
  const fieldId = await getFieldId(page, labelText);
  const locator = page.locator(`[id=${JSON.stringify(fieldId)}]`).first();
  await locator.scrollIntoViewIfNeeded();
  await locator.click();
  await locator.fill(value);
  await page.keyboard.press("ArrowDown").catch(() => undefined);
  await page.keyboard.press("Enter").catch(() => undefined);
}

async function getFieldId(page: Page, labelText: string) {
  const label = await findMatchingLabel(page, normalizeLabel(labelText));
  if (!label) {
    throw new Error(`Field label not found: ${labelText}`);
  }
  const fieldId = await label.getAttribute("for");
  if (!fieldId) {
    throw new Error(`Field label does not reference an input: ${labelText}`);
  }
  return fieldId;
}

async function fieldKind(page: Page, labelText: string) {
  const fieldId = await getFieldId(page, labelText);
  const locator = page.locator(`[id=${JSON.stringify(fieldId)}]`).first();
  const metadata = await locator.evaluate((element) => ({
    tagName: (element.tagName || "").toLowerCase(),
    type: (element.getAttribute("type") || "").toLowerCase(),
    role: (element.getAttribute("role") || "").toLowerCase(),
  }));
  if (metadata.tagName === "select" || metadata.role === "combobox") {
    return "select";
  }
  return "text";
}

async function findMatchingLabel(page: Page, query: string) {
  const labels = page.locator("label");
  const count = await labels.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = labels.nth(index);
    const text = normalizeLabel((await candidate.innerText()).trim().replaceAll("*", ""));
    if (!text) {
      continue;
    }
    if (text === query || (query.length >= 10 && text.includes(query))) {
      return candidate;
    }
  }
  return null;
}

async function findDisplayLabel(page: Page, query: string) {
  const label = await findMatchingLabel(page, query);
  if (label) {
    return (await label.innerText()).trim().replaceAll("*", "");
  }

  const legends = page.locator("legend");
  const count = await legends.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = legends.nth(index);
    const text = normalizeLabel((await candidate.innerText()).trim().replaceAll("*", ""));
    if (text === query || (query.length >= 10 && text.includes(query))) {
      return (await candidate.innerText()).trim().replaceAll("*", "");
    }
  }
  return null;
}
