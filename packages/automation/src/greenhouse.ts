import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { promisify } from "node:util";

import type { GeneratedAnswer, StructuredApplicationDefaults } from "@jobhunter/core";
import { applicationCheckpointSchema, resolveDataPath } from "@jobhunter/core";
import type { Frame, Locator, Page, Route } from "playwright";
import { chromium } from "playwright";

import { resolveStructuredValueWithAssistance } from "./assisted-field-resolution";
import { detectCheckpointFromText } from "./checkpoints";
import { detectManualActionType, normalizeLabel } from "./field-mapping";
import type { ApplyResult } from "./result";

const SUBMIT_SUCCESS = /(thank you|application submitted|application received|we ll be in touch|successfully submitted)/i;
const SUBMIT_ERROR = /(please fix|field is required|invalid|error)/i;
const GREENHOUSE_EMBED_URL = /job-boards\.greenhouse\.io\/embed\/job_app/i;
const CAPTCHA_FRAME_URL = /(recaptcha|hcaptcha|turnstile|arkose)/i;
const execFileAsync = promisify(execFile);

type FormRoot = Page | Frame;

type FormSurface = {
  root: FormRoot;
  kind: "page" | "iframe";
  topLevelUrl: string;
  frameUrl?: string;
};

type PromptTarget = {
  kind: "label" | "legend";
  displayLabel: string;
  normalizedLabel: string;
};

type ApplyToHostedJobInput = {
  source: "greenhouse" | "mock";
  entryUrl: string;
  applyUrl: string;
  defaults: StructuredApplicationDefaults;
  fieldOverrides?: Record<string, string>;
  resumePath: string;
  generatedAnswers: GeneratedAnswer[];
  applicationId: string;
  dryRun?: boolean;
};

export async function applyToGreenhouseJob(input: {
  jobUrl: string;
  defaults: StructuredApplicationDefaults;
  fieldOverrides?: Record<string, string>;
  resumePath: string;
  generatedAnswers: GeneratedAnswer[];
  applicationId: string;
  dryRun?: boolean;
}): Promise<ApplyResult> {
  return applyToHostedJobForm({
    source: "greenhouse",
    entryUrl: input.jobUrl,
    applyUrl: deriveGreenhouseApplyUrl(input.jobUrl),
    defaults: input.defaults,
    fieldOverrides: input.fieldOverrides,
    resumePath: input.resumePath,
    generatedAnswers: input.generatedAnswers,
    applicationId: input.applicationId,
    dryRun: input.dryRun,
  });
}

export async function applyToMockJob(input: {
  jobUrl: string;
  defaults: StructuredApplicationDefaults;
  fieldOverrides?: Record<string, string>;
  resumePath: string;
  generatedAnswers: GeneratedAnswer[];
  applicationId: string;
  dryRun?: boolean;
}): Promise<ApplyResult> {
  return applyToHostedJobForm({
    source: "mock",
    entryUrl: input.jobUrl,
    applyUrl: input.jobUrl,
    defaults: input.defaults,
    fieldOverrides: input.fieldOverrides,
    resumePath: input.resumePath,
    generatedAnswers: input.generatedAnswers,
    applicationId: input.applicationId,
    dryRun: input.dryRun,
  });
}

async function applyToHostedJobForm(input: ApplyToHostedJobInput): Promise<ApplyResult> {
  const preparedPayload = {
    source: input.source,
    entryUrl: input.entryUrl,
    applyUrl: input.applyUrl,
    defaults: input.defaults,
    fieldOverrides: input.fieldOverrides ?? {},
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
    if (input.source === "greenhouse") {
      await installGreenhouseHostedAssetProxy(page, input.entryUrl);
    }

    const surface = input.source === "greenhouse"
      ? await resolveGreenhouseFormSurface(page, input)
      : await openDirectFormSurface(page, input.applyUrl);
    const topLevelUrl = page.url() || input.applyUrl;
    const formRoot = surface?.root ?? page;
    const pageTextBeforeSubmit = await readCombinedSurfaceText(page, formRoot);

    if (!surface) {
      const detectedManualAction = detectManualActionType(pageTextBeforeSubmit);
      const checkpoint = applicationCheckpointSchema.parse({
        manualActionType: detectedManualAction ?? "unknown_form_structure",
        reason: detectedManualAction
          ? "A manual verification step appeared before the application form became available."
          : "A supported Greenhouse application form could not be located from the hosted job page.",
        currentUrl: topLevelUrl,
        preparedFields: {},
      });
      const artifacts = await captureCheckpointArtifacts(page, input.applicationId, pageTextBeforeSubmit, page);
      return {
        success: false,
        submitted: false,
        dryRun: Boolean(input.dryRun),
        source: input.source,
        applyUrl: input.applyUrl,
        checkpoint,
        manualActionType: checkpoint.manualActionType,
        blockingReason: checkpoint.reason,
        filledFields,
        unknownRequiredFields,
        missingProfileFields,
        preparedPayload,
        checkpointArtifacts: artifacts,
        currentUrl: topLevelUrl,
      };
    }

    await fillCommonFields(formRoot, input.defaults, filledFields);
    await uploadResume(formRoot, input.resumePath, filledFields);
    await fillKnownRequiredFields(
      formRoot,
      page,
      input.applyUrl,
      input.defaults,
      input.fieldOverrides ?? {},
      input.generatedAnswers,
      filledFields,
      unknownRequiredFields,
      missingProfileFields,
    );
    await fillRecognizedOptionalFields(
      formRoot,
      page,
      input.applyUrl,
      input.defaults,
      input.fieldOverrides ?? {},
      input.generatedAnswers,
      filledFields,
    );

    const pageText = await readCombinedSurfaceText(page, formRoot);
    const checkpoint = detectCheckpointFromText(pageText);
    const detectedManualAction = await detectManualActionSignal(page, formRoot, pageText);
    if (detectedManualAction || checkpoint) {
      const typedCheckpoint = applicationCheckpointSchema.parse({
        manualActionType: detectedManualAction?.manualActionType
          ?? checkpoint?.manualActionType
          ?? "security_verification",
        reason: detectedManualAction?.reason
          ?? checkpoint?.reason
          ?? "Manual verification or anti-bot protection was detected.",
        currentUrl: topLevelUrl,
        preparedFields: {},
      });
      const artifacts = await captureCheckpointArtifacts(page, input.applicationId, pageText, formRoot);
      return {
        success: false,
        submitted: false,
        dryRun: Boolean(input.dryRun),
        source: input.source,
        applyUrl: input.applyUrl,
        checkpoint: typedCheckpoint,
        manualActionType: typedCheckpoint.manualActionType,
        blockingReason: typedCheckpoint.reason,
        filledFields,
        unknownRequiredFields,
        missingProfileFields,
        preparedPayload: {
          ...preparedPayload,
          surfaceKind: surface.kind,
          frameUrl: surface.frameUrl,
        },
        checkpointArtifacts: artifacts,
        currentUrl: topLevelUrl,
      };
    }

    if (unknownRequiredFields.length > 0 || missingProfileFields.length > 0) {
      const artifacts = await captureCheckpointArtifacts(page, input.applicationId, pageText, formRoot);
      return {
        success: false,
        submitted: false,
        dryRun: Boolean(input.dryRun),
        source: input.source,
        applyUrl: input.applyUrl,
        checkpoint: {
          manualActionType: "missing_required_info",
          reason: "Required fields remain unresolved after structured autofill.",
          currentUrl: topLevelUrl,
          preparedFields: {},
        },
        manualActionType: "missing_required_info",
        blockingReason: "Required fields remain unresolved after structured autofill.",
        filledFields,
        unknownRequiredFields,
        missingProfileFields,
        preparedPayload: {
          ...preparedPayload,
          surfaceKind: surface.kind,
          frameUrl: surface.frameUrl,
        },
        checkpointArtifacts: artifacts,
        currentUrl: topLevelUrl,
      };
    }

    if (input.dryRun) {
      return {
        success: true,
        submitted: false,
        dryRun: true,
        source: input.source,
        applyUrl: input.applyUrl,
        filledFields,
        unknownRequiredFields,
        missingProfileFields,
        preparedPayload: {
          ...preparedPayload,
          surfaceKind: surface.kind,
          frameUrl: surface.frameUrl,
        },
        currentUrl: topLevelUrl,
      };
    }

    const submitButton = await findSubmitButton(formRoot);
    if (!submitButton) {
      const artifacts = await captureCheckpointArtifacts(page, input.applicationId, pageText, formRoot);
      return {
        success: false,
        submitted: false,
        dryRun: false,
        source: input.source,
        applyUrl: input.applyUrl,
        checkpoint: {
          manualActionType: "ambiguous_submit_state",
          reason: "A submission control was not found after the form was filled.",
          currentUrl: topLevelUrl,
          preparedFields: {},
        },
        manualActionType: "ambiguous_submit_state",
        blockingReason: "A submission control was not found after the form was filled.",
        filledFields,
        unknownRequiredFields,
        missingProfileFields,
        preparedPayload: {
          ...preparedPayload,
          surfaceKind: surface.kind,
          frameUrl: surface.frameUrl,
        },
        checkpointArtifacts: artifacts,
        currentUrl: topLevelUrl,
      };
    }

    await submitButton.scrollIntoViewIfNeeded();
    await submitButton.click();
    const confirmationText = await waitForSubmissionConfirmation(page, formRoot);
    return {
      success: true,
      submitted: true,
      dryRun: false,
      source: input.source,
      applyUrl: input.applyUrl,
      confirmationText,
      filledFields,
      unknownRequiredFields,
      missingProfileFields,
      preparedPayload: {
        ...preparedPayload,
        surfaceKind: surface.kind,
        frameUrl: surface.frameUrl,
      },
      currentUrl: page.url() || topLevelUrl,
    };
  } catch (error) {
    return {
      success: false,
      submitted: false,
      dryRun: Boolean(input.dryRun),
      source: input.source,
      applyUrl: input.applyUrl,
      error: error instanceof Error ? error.message : "Autofill failed.",
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
  if (jobUrl.includes("/apply/")) {
    return jobUrl;
  }
  try {
    const parsed = new URL(jobUrl);
    if (parsed.host.includes("greenhouse") && parsed.pathname.includes("/jobs/")) {
      return parsed.toString().replace("/jobs/", "/apply/");
    }
    return jobUrl;
  } catch {
    // Fall through to string-based handling for malformed but usable URLs.
  }
  if (jobUrl.includes("greenhouse") && jobUrl.includes("/jobs/")) {
    return jobUrl.replace("/jobs/", "/apply/");
  }
  return jobUrl;
}

async function openDirectFormSurface(page: Page, applyUrl: string): Promise<FormSurface> {
  await navigate(page, applyUrl);
  return {
    root: page,
    kind: "page",
    topLevelUrl: page.url() || applyUrl,
  };
}

async function resolveGreenhouseFormSurface(
  page: Page,
  input: Pick<ApplyToHostedJobInput, "entryUrl" | "applyUrl">,
): Promise<FormSurface | null> {
  await navigate(page, input.applyUrl);
  let surface = await detectGreenhouseFormSurface(page);
  if (surface) {
    return surface;
  }

  if (input.entryUrl !== input.applyUrl) {
    await navigate(page, input.entryUrl);
    surface = await detectGreenhouseFormSurface(page);
    if (surface) {
      return surface;
    }
  }

  if (await openHostedApplyDestination(page)) {
    surface = await detectGreenhouseFormSurface(page);
    if (surface) {
      return surface;
    }
  }

  const derivedHostedApplyUrl = deriveHostedGreenhouseApplyUrl(page.url());
  if (derivedHostedApplyUrl && derivedHostedApplyUrl !== page.url()) {
    await navigate(page, derivedHostedApplyUrl);
    surface = await detectGreenhouseFormSurface(page);
    if (surface) {
      return surface;
    }
  }

  if (await openEmbeddedGreenhouseFormDirectly(page)) {
    surface = await detectGreenhouseFormSurface(page);
    if (surface) {
      return surface;
    }
  }

  return null;
}

async function detectGreenhouseFormSurface(page: Page): Promise<FormSurface | null> {
  const embeddedFrame = await findGreenhouseEmbedFrame(page, 5000);
  if (embeddedFrame && await looksLikeGreenhouseForm(embeddedFrame)) {
    return {
      root: embeddedFrame,
      kind: "iframe",
      topLevelUrl: page.url(),
      frameUrl: embeddedFrame.url(),
    };
  }

  if (await looksLikeGreenhouseForm(page)) {
    return {
      root: page,
      kind: "page",
      topLevelUrl: page.url(),
    };
  }

  return null;
}

async function installGreenhouseHostedAssetProxy(page: Page, url: string) {
  if (!isStripeHostedGreenhouseUrl(url)) {
    return;
  }

  await page.route("https://b.stripecdn.com/**", async (route) => {
    try {
      await proxyHostedAssetRequest(route);
    } catch {
      await route.continue().catch(() => route.abort("failed").catch(() => undefined));
    }
  });
}

async function proxyHostedAssetRequest(route: Route) {
  const url = route.request().url();

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: filterForwardHeaders(route.request().headers()),
    });
    if (response.ok) {
      const body = Buffer.from(await response.arrayBuffer());
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body,
      });
      return;
    }
  } catch {
    // Fall through to curl.
  }

  const body = await fetchBinaryWithCurl(url);
  await route.fulfill({
    status: 200,
    contentType: inferContentTypeFromUrl(url),
    body,
  });
}

function filterForwardHeaders(headers: Record<string, string>) {
  const allowed = new Set(["accept", "accept-language", "user-agent"]);
  return Object.fromEntries(
    Object.entries(headers).filter(([key]) => allowed.has(key.toLowerCase())),
  );
}

async function fetchBinaryWithCurl(url: string) {
  const { stdout } = await execFileAsync(
    "curl",
    ["-L", "--silent", "--show-error", "--fail", "--retry", "2", "--connect-timeout", "20", url],
    {
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
}

function inferContentTypeFromUrl(url: string) {
  try {
    switch (extname(new URL(url).pathname).toLowerCase()) {
      case ".css":
        return "text/css; charset=utf-8";
      case ".js":
        return "application/javascript; charset=utf-8";
      case ".svg":
        return "image/svg+xml";
      case ".woff2":
        return "font/woff2";
      case ".woff":
        return "font/woff";
      case ".ttf":
        return "font/ttf";
      case ".png":
        return "image/png";
      case ".jpg":
      case ".jpeg":
        return "image/jpeg";
      default:
        return "application/octet-stream";
    }
  } catch {
    return "application/octet-stream";
  }
}

async function navigate(page: Page, url: string) {
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await page.waitForTimeout(1500);
}

async function openHostedApplyDestination(page: Page) {
  const hrefCandidate = page.locator('a[href*="/apply"]').first();
  if (await hrefCandidate.count()) {
    const href = await hrefCandidate.getAttribute("href");
    if (href) {
      const destination = new URL(href, page.url()).toString();
      await navigate(page, destination);
      return true;
    }
  }

  const interactionCandidates = [
    page.getByRole("link", { name: /apply/i }).first(),
    page.getByRole("button", { name: /apply/i }).first(),
  ];

  for (const candidate of interactionCandidates) {
    if (!(await candidate.count())) {
      continue;
    }
    await Promise.allSettled([
      page.waitForLoadState("domcontentloaded", { timeout: 15_000 }),
      candidate.click(),
    ]);
    await page.waitForTimeout(2000);
    return true;
  }

  return false;
}

async function openEmbeddedGreenhouseFormDirectly(page: Page) {
  const iframe = page.locator("iframe#grnhse_iframe, iframe[src*='job-boards.greenhouse.io/embed/job_app']").first();
  if (!(await iframe.count())) {
    return false;
  }

  const src = await iframe.getAttribute("src");
  if (!src) {
    return false;
  }

  const destination = new URL(src, page.url()).toString();
  await navigate(page, destination);
  return true;
}

function deriveHostedGreenhouseApplyUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (/\/jobs\/listing\/[^/]+\/\d+\/apply\/?$/.test(parsed.pathname)) {
      return parsed.toString();
    }
    const match = parsed.pathname.match(/^(\/jobs\/listing\/[^/]+\/\d+)\/?$/);
    if (!match) {
      return null;
    }
    parsed.pathname = `${match[1]}/apply`;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

async function findGreenhouseEmbedFrame(page: Page, waitMs: number) {
  const deadline = Date.now() + waitMs;
  do {
    const frame = page.frames().find((candidate) => GREENHOUSE_EMBED_URL.test(candidate.url()));
    if (frame) {
      await frame.waitForLoadState("domcontentloaded").catch(() => undefined);
      await page.waitForTimeout(750);
      return frame;
    }
    if (Date.now() >= deadline) {
      break;
    }
    await page.waitForTimeout(250);
  } while (true);

  return null;
}

async function looksLikeGreenhouseForm(root: FormRoot) {
  const markers = [
    "form#application_form",
    "input[name*='first_name']",
    "input[name*='last_name']",
    "input[name*='email']",
    "#application_form",
  ];
  for (const selector of markers) {
    const locator = root.locator(selector).first();
    if (await locator.count()) {
      return true;
    }
  }
  const labelCount = await root.locator("label").count().catch(() => 0);
  if (labelCount >= 8) {
    const bodyText = await readBodyText(root);
    if (/(apply for this job|first name|last name|resume\/cv|location city)/i.test(bodyText)) {
      return true;
    }
  }
  return false;
}

function isStripeHostedGreenhouseUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.host === "stripe.com" && (parsed.searchParams.has("gh_jid") || parsed.pathname.startsWith("/jobs/"));
  } catch {
    return url.includes("stripe.com") && (url.includes("gh_jid=") || url.includes("/jobs/"));
  }
}

async function fillCommonFields(root: FormRoot, defaults: StructuredApplicationDefaults, filledFields: string[]) {
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
    if (await labelExists(root, label)) {
      await fillTextField(root, label, value);
      filledFields.push(label);
    }
  }
}

async function uploadResume(root: FormRoot, resumePath: string, filledFields: string[]) {
  const candidates = [
    'input[type="file"]#resume',
    'input[type="file"][name*="resume"]',
    'input[type="file"][id*="resume"]',
  ];
  for (const selector of candidates) {
    const locator = root.locator(selector).first();
    if (await locator.count()) {
      await locator.setInputFiles(resumePath);
      filledFields.push("Resume");
      return;
    }
  }
}

async function fillKnownRequiredFields(
  root: FormRoot,
  page: Page,
  applyUrl: string,
  defaults: StructuredApplicationDefaults,
  fieldOverrides: Record<string, string>,
  generatedAnswers: GeneratedAnswer[],
  filledFields: string[],
  unknownRequiredFields: string[],
  missingProfileFields: string[],
) {
  const requiredLabels = await getPromptTargets(root, { requiredOnly: true });
  const sourceHost = safeHostFromUrl(applyUrl);

  for (const prompt of requiredLabels) {
    if (filledFields.some((filled) => normalizeLabel(filled) === prompt.normalizedLabel)) {
      continue;
    }

    const overrideValue = resolveFieldOverride(fieldOverrides, prompt.displayLabel);
    if (overrideValue) {
      const overrideFilled = await fillPromptTarget(root, page, prompt, overrideValue).catch(() => false);
      if (overrideFilled) {
        filledFields.push(prompt.displayLabel);
        continue;
      }
    }

    const resolved = await resolveStructuredValueWithAssistance({
      sourceHost,
      label: prompt.displayLabel,
      defaults,
      generatedAnswers,
    });
    if (!resolved.value) {
      if (resolved.missingField) {
        missingProfileFields.push(resolved.missingField);
      } else {
        unknownRequiredFields.push(prompt.displayLabel);
      }
      continue;
    }

    const wasFilled = await fillPromptTarget(root, page, prompt, resolved.value).catch(() => false);
    if (!wasFilled) {
      unknownRequiredFields.push(prompt.displayLabel);
      continue;
    }
    filledFields.push(prompt.displayLabel);
  }
}

async function fillRecognizedOptionalFields(
  root: FormRoot,
  page: Page,
  applyUrl: string,
  defaults: StructuredApplicationDefaults,
  fieldOverrides: Record<string, string>,
  generatedAnswers: GeneratedAnswer[],
  filledFields: string[],
) {
  const sourceHost = safeHostFromUrl(applyUrl);
  const prompts = await getPromptTargets(root, { requiredOnly: false });

  for (const prompt of prompts) {
    if (filledFields.some((filled) => normalizeLabel(filled) === prompt.normalizedLabel)) {
      continue;
    }

    const overrideValue = resolveFieldOverride(fieldOverrides, prompt.displayLabel);
    if (overrideValue) {
      const overrideFilled = await fillPromptTarget(root, page, prompt, overrideValue).catch(() => false);
      if (overrideFilled) {
        filledFields.push(prompt.displayLabel);
      }
      continue;
    }

    const resolved = await resolveStructuredValueWithAssistance({
      sourceHost,
      label: prompt.displayLabel,
      defaults,
      generatedAnswers,
    });
    if (!resolved.value || resolved.strategy.kind === "none") {
      continue;
    }

    const wasFilled = await fillPromptTarget(root, page, prompt, resolved.value).catch(() => false);
    if (wasFilled) {
      filledFields.push(prompt.displayLabel);
    }
  }
}

async function getPromptTargets(root: FormRoot, options: { requiredOnly: boolean }) {
  const values = new Map<string, PromptTarget>();
  for (const selector of ["label", "legend"] as const) {
    const locator = root.locator(selector);
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const text = (await locator.nth(index).innerText()).trim();
      if (options.requiredOnly && !text.includes("*")) {
        continue;
      }
      const displayLabel = text.replaceAll("*", "").trim();
      const normalizedLabel = normalizeLabel(displayLabel);
      if (!normalizedLabel || values.has(normalizedLabel)) {
        continue;
      }
      values.set(normalizedLabel, {
        kind: selector,
        displayLabel,
        normalizedLabel,
      });
    }
  }
  return [...values.values()];
}

async function fillPromptTarget(root: FormRoot, page: Page, prompt: PromptTarget, value: string) {
  if (prompt.kind === "legend") {
    return chooseFieldsetOption(root, prompt.displayLabel, value);
  }

  const kind = await fieldKind(root, prompt.displayLabel);
  if (kind === "select") {
    await selectOption(root, page, prompt.displayLabel, value);
    return true;
  }
  if (kind === "radio") {
    return chooseLabeledBoolean(root, prompt.displayLabel, value);
  }

  await fillTextField(root, prompt.displayLabel, value);
  return true;
}

async function captureCheckpointArtifacts(
  page: Page,
  applicationId: string,
  pageText: string,
  root: FormRoot,
) {
  const directory = resolveDataPath("manual_checkpoints", applicationId);
  await mkdir(directory, { recursive: true });
  const screenshotPath = join(directory, "checkpoint.png");
  const htmlPath = join(directory, "checkpoint.html");
  const textPath = join(directory, "checkpoint.txt");
  const formHtmlPath = join(directory, "form.html");
  const formTextPath = join(directory, "form.txt");

  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  await writeFile(htmlPath, await page.content(), "utf8").catch(() => undefined);
  await writeFile(textPath, pageText, "utf8").catch(() => undefined);
  if (root !== page) {
    await writeFile(formHtmlPath, await root.content(), "utf8").catch(() => undefined);
    await writeFile(formTextPath, await readBodyText(root), "utf8").catch(() => undefined);
  }

  return {
    screenshotPath,
    htmlPath,
    textPath,
    ...(root !== page ? { formHtmlPath, formTextPath } : {}),
  };
}

async function waitForSubmissionConfirmation(page: Page, originalRoot: FormRoot) {
  const originalUrl = page.url();
  await page.waitForTimeout(1200);
  for (let attempts = 0; attempts < 50; attempts += 1) {
    const liveRoot = originalRoot === page
      ? page
      : await findGreenhouseEmbedFrame(page, 0) ?? page;
    const text = await readCombinedSurfaceText(page, liveRoot);
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

async function findSubmitButton(root: FormRoot) {
  const roleButton = root.getByRole("button", { name: /submit( application)?/i }).first();
  if (await roleButton.count()) {
    return roleButton;
  }

  const selectorButton = root.locator("button[type='submit'], input[type='submit']").first();
  if (await selectorButton.count()) {
    return selectorButton;
  }

  return null;
}

async function detectManualActionSignal(page: Page, root: FormRoot, combinedText: string) {
  if (await hasCaptchaIndicator(page, root)) {
    return {
      manualActionType: "captcha" as const,
      reason: "The application form was filled, but CAPTCHA requires you to complete the final submission step.",
    };
  }

  const checkpoint = detectCheckpointFromText(combinedText);
  if (checkpoint) {
    return checkpoint;
  }

  const detectedManualAction = detectManualActionType(combinedText);
  if (detectedManualAction) {
    return {
      manualActionType: detectedManualAction,
      reason: `Detected ${detectedManualAction.replaceAll("_", " ")} during application automation.`,
    };
  }

  return null;
}

async function hasCaptchaIndicator(page: Page, root: FormRoot) {
  const selectors = [
    "iframe[src*='recaptcha']",
    "iframe[title*='reCAPTCHA']",
    "iframe[src*='hcaptcha']",
    "iframe[src*='turnstile']",
    "iframe[src*='arkoselabs']",
    "textarea[name*='g-recaptcha-response']",
    ".g-recaptcha",
    ".h-captcha",
    "[data-sitekey]",
  ];

  for (const selector of selectors) {
    if (await root.locator(selector).count().catch(() => 0)) {
      return true;
    }
  }

  return page.frames().some((frame) => CAPTCHA_FRAME_URL.test(frame.url()));
}

async function labelExists(root: FormRoot, label: string) {
  return (await findMatchingLabel(root, normalizeLabel(label))) !== null;
}

async function fillTextField(root: FormRoot, labelText: string, value: string) {
  const locator = await getFieldLocator(root, labelText);
  await locator.scrollIntoViewIfNeeded();
  await locator.fill(value);
}

async function selectOption(root: FormRoot, page: Page, labelText: string, value: string) {
  const locator = await getFieldLocator(root, labelText);
  await locator.scrollIntoViewIfNeeded();
  const tagName = await locator.evaluate((element) => (element.tagName || "").toLowerCase());
  if (tagName === "select") {
    const options = await locator.evaluate((element) => {
      if (!(element instanceof HTMLSelectElement)) {
        return [];
      }
      return Array.from(element.options).map((option) => ({
        value: option.value,
        label: option.label,
        text: option.text,
      }));
    });
    const matchedOption = matchOptionValue(
      options.map((option) => ({ value: option.value, label: option.label || option.text || option.value })),
      value,
    );

    if (matchedOption?.value) {
      await locator.selectOption(matchedOption.value);
      return;
    }
  }
  await locator.click();
  await locator.fill(value);
  await page.keyboard.press("ArrowDown").catch(() => undefined);
  await page.keyboard.press("Enter").catch(() => undefined);
}

async function chooseFieldsetOption(root: FormRoot, legendText: string, value: string) {
  const legend = await findMatchingLegend(root, normalizeLabel(legendText));
  if (!legend) {
    return false;
  }

  const fieldset = legend.locator("xpath=ancestor::fieldset[1]").first();
  if (!(await fieldset.count())) {
    return false;
  }

  const labels = fieldset.locator("label");
  const count = await labels.count();
  const options: Array<{ index: number; label: string }> = [];
  for (let index = 0; index < count; index += 1) {
    const text = (await labels.nth(index).innerText()).trim();
    if (!text) {
      continue;
    }
    options.push({ index, label: text });
  }

  const match = matchOptionValue(
    options.map((option) => ({ value: String(option.index), label: option.label })),
    value,
  );
  if (!match) {
    return false;
  }

  const targetLabel = labels.nth(Number(match.value));
  await targetLabel.scrollIntoViewIfNeeded();
  await targetLabel.click();
  return true;
}

async function chooseLabeledBoolean(root: FormRoot, labelText: string, value: string) {
  const normalizedValue = inferBooleanChoice(value);
  if (!normalizedValue) {
    return false;
  }
  const normalizedLabel = normalizeLabel(labelText);
  const labels = root.locator("label");
  const count = await labels.count();
  for (let index = 0; index < count; index += 1) {
    const label = labels.nth(index);
    const text = normalizeLabel((await label.innerText()).trim().replaceAll("*", ""));
    if (!(text.includes(normalizedLabel) || normalizedLabel.includes(text))) {
      continue;
    }
    if (!text.includes(normalizedValue)) {
      continue;
    }
    await label.scrollIntoViewIfNeeded();
    await label.click();
    return true;
  }
  return false;
}

async function getFieldLocator(root: FormRoot, labelText: string): Promise<Locator> {
  const label = await findMatchingLabel(root, normalizeLabel(labelText));
  if (!label) {
    throw new Error(`Field label not found: ${labelText}`);
  }
  const fieldId = await label.getAttribute("for");
  if (fieldId) {
    return root.locator(`[id=${JSON.stringify(fieldId)}]`).first();
  }

  const nestedField = label.locator("input, textarea, select, [role='combobox']").first();
  if (await nestedField.count()) {
    return nestedField;
  }

  throw new Error(`Field label does not reference or contain an input: ${labelText}`);
}

async function fieldKind(root: FormRoot, labelText: string) {
  const locator = await getFieldLocator(root, labelText);
  const metadata = await locator.evaluate((element) => ({
    tagName: (element.tagName || "").toLowerCase(),
    type: (element.getAttribute("type") || "").toLowerCase(),
    role: (element.getAttribute("role") || "").toLowerCase(),
  }));
  if (metadata.tagName === "select" || metadata.role === "combobox") {
    return "select";
  }
  if (metadata.type === "radio" || metadata.type === "checkbox") {
    return "radio";
  }
  return "text";
}

async function findMatchingLabel(root: FormRoot, query: string) {
  const labels = root.locator("label");
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

async function findMatchingLegend(root: FormRoot, query: string) {
  const legends = root.locator("legend");
  const count = await legends.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = legends.nth(index);
    const text = normalizeLabel((await candidate.innerText()).trim().replaceAll("*", ""));
    if (!text) {
      continue;
    }
    if (text === query || (query.length >= 10 && text.includes(query)) || query.includes(text)) {
      return candidate;
    }
  }
  return null;
}

function matchOptionValue(
  options: Array<{ value: string; label: string }>,
  requestedValue: string,
) {
  const requestVariants = expandComparableValues(requestedValue);
  const normalizedRequest = requestVariants[0] ?? normalizeLabel(requestedValue);
  const directMatch = options.find((option) => {
    const normalizedOption = normalizeLabel(option.label);
    return requestVariants.some((variant) =>
      normalizedOption === variant
      || normalizedOption.includes(variant)
      || variant.includes(normalizedOption),
    );
  });
  if (directMatch) {
    return directMatch;
  }

  const booleanChoice = inferBooleanChoice(requestedValue);
  if (booleanChoice) {
    const booleanMatch = options.find((option) => normalizeLabel(option.label) === booleanChoice);
    if (booleanMatch) {
      return booleanMatch;
    }
  }

  return options.find((option) => {
    const normalizedOption = normalizeLabel(option.label);
    return requestVariants.some((variant) =>
      variant.split(" ").some((token) => token.length >= 2 && normalizedOption.includes(token)),
    );
  }) ?? null;
}

function expandComparableValues(value: string) {
  const normalized = normalizeLabel(value);
  const variants = new Set([normalized]);

  const countryAliases: Record<string, string[]> = {
    "united states": ["us", "u s", "usa"],
    us: ["united states", "u s", "usa"],
    "united kingdom": ["uk", "u k"],
    uk: ["united kingdom", "u k"],
    "united arab emirates": ["uae", "u a e"],
    uae: ["united arab emirates", "u a e"],
  };

  for (const alias of countryAliases[normalized] ?? []) {
    variants.add(alias);
  }

  return [...variants];
}

function inferBooleanChoice(value: string) {
  const normalized = normalizeLabel(value);
  if (
    normalized === "no"
    || normalized.includes("do not")
    || normalized.includes("does not")
    || normalized.includes("not a protected veteran")
    || normalized.includes("no disability")
    || normalized.includes("without sponsorship")
    || normalized.includes("no sponsorship")
  ) {
    return "no";
  }
  if (
    normalized === "yes"
    || normalized.includes("authorized to work")
    || normalized.includes("u s citizen")
    || normalized.includes("us citizen")
    || normalized.includes("eligible to work")
    || normalized.includes("consent")
    || normalized.includes("opt in")
  ) {
    return "yes";
  }
  return null;
}

async function readCombinedSurfaceText(page: Page, root: FormRoot) {
  const rootText = await readBodyText(root);
  if (root === page) {
    return rootText;
  }
  const pageText = await readBodyText(page);
  return [rootText, pageText].filter(Boolean).join("\n\n");
}

async function readBodyText(root: FormRoot) {
  return root.locator("body").innerText().catch(() => "");
}

function safeHostFromUrl(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "unknown-host";
  }
}

function resolveFieldOverride(overrides: Record<string, string>, label: string) {
  const normalizedLabel = normalizeLabel(label);
  const candidate = overrides[normalizedLabel];
  if (!candidate) {
    return null;
  }
  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : null;
}
