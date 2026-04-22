type TrackerStateInput = {
  status: string;
  blockingReason?: string | null;
  manualActionType?: string | null;
  preparedPayload?: unknown;
  submittedAt?: string | null;
  needsUserActionAt?: string | null;
  updatedAt?: string | null;
};

type TrackerStateSummary = {
  label: string;
  detail: string;
};

type AutofillActionSummary = {
  label: string;
  hint: string;
};

const manualActionLabels: Record<string, string> = {
  captcha: "CAPTCHA",
  email_verification_code: "email verification",
  security_verification: "security verification",
  upload_failure: "upload failure",
  unknown_form_structure: "an unknown form structure",
  missing_required_info: "missing required information",
  ambiguous_submit_state: "an ambiguous submit state",
};

export function formatTimestamp(timestamp: string | null | undefined) {
  if (!timestamp) {
    return "Unknown time";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

export function describeTrackerState(input: TrackerStateInput): TrackerStateSummary {
  switch (input.status) {
    case "auto_submitted":
    case "submitted":
      return {
        label: "Actually submitted",
        detail: `Confirmed complete on ${formatTimestamp(input.submittedAt ?? input.updatedAt)}.`,
      };
    case "needs_user_action":
      return {
        label: "Started on site, needs you",
        detail: `${buildPauseSummary(input)} ${buildPreparedSummary(input.preparedPayload)} Use Open and continue to return to the saved step.`,
      };
    case "prepared":
      return {
        label: "Ready to open and fill",
        detail: `${buildPreparedSummary(input.preparedPayload)} Use Open and autofill to open the application page and start the saved packet.`,
      };
    case "queued":
      return {
        label: "Queued for preparation",
        detail: buildQueuedSummary(input.preparedPayload),
      };
    case "skipped":
      return {
        label: "Skipped",
        detail: "The role did not pass the configured rules or fit threshold.",
      };
    default:
      return {
        label: "In progress",
        detail: "The job is still moving through discovery, scoring, or application preparation.",
      };
  }
}

function buildPauseSummary(input: TrackerStateInput) {
  const blockerLabel = input.manualActionType ? manualActionLabels[input.manualActionType] ?? input.manualActionType : null;
  const seenAt = input.needsUserActionAt ? ` on ${formatTimestamp(input.needsUserActionAt)}` : "";

  if (blockerLabel && input.blockingReason) {
    return `Paused${seenAt} on ${blockerLabel}: ${input.blockingReason}`.trim();
  }

  if (blockerLabel) {
    return `Paused${seenAt} on ${blockerLabel}.`.trim();
  }

  if (input.blockingReason) {
    return `Paused${seenAt}: ${input.blockingReason}`.trim();
  }

  return "Paused because the flow needed a human check.";
}

function buildPreparedSummary(payload: unknown) {
  const stats = extractPreparedMaterialStats(payload);
  if (!stats) {
    return "Prepared data is saved in JobHunter.";
  }

  const parts: string[] = [];
  if (stats.autofillFieldCount > 0) {
    parts.push(`${stats.autofillFieldCount} saved profile field${stats.autofillFieldCount === 1 ? "" : "s"}`);
  }
  if (stats.answerCount > 0) {
    parts.push(`${stats.answerCount} short answer${stats.answerCount === 1 ? "" : "s"}`);
  }
  if (stats.hasTailoredResume) {
    parts.push("a tailored resume");
  }

  if (parts.length === 0) {
    return "Prepared data is saved in JobHunter.";
  }

  return `Prepared in JobHunter: ${parts.join(", ")}.`;
}

function buildQueuedSummary(payload: unknown) {
  if (isRecord(payload) && typeof payload.queuedReason === "string" && payload.queuedReason.trim()) {
    return payload.queuedReason;
  }

  return "This job passed the fit rules, but the application packet is waiting for the next available preparation slot.";
}

function extractPreparedMaterialStats(payload: unknown) {
  if (!isRecord(payload)) {
    return null;
  }

  const structuredDefaults = isRecord(payload.structuredDefaults) ? payload.structuredDefaults : null;
  const autofillFieldCount = structuredDefaults
    ? Object.values(structuredDefaults).filter(hasMeaningfulValue).length
    : 0;
  const answerCount = countPreparedAnswers(payload.generatedAnswers);
  const tailoredResume = isRecord(payload.tailoredResume) ? payload.tailoredResume : null;
  const hasTailoredResume = Boolean(
    tailoredResume
      && (
        hasMeaningfulValue(tailoredResume.summaryLine)
        || (Array.isArray(tailoredResume.tailoredBullets) && tailoredResume.tailoredBullets.length > 0)
      ),
  );

  return {
    autofillFieldCount,
    answerCount,
    hasTailoredResume,
  };
}

function countPreparedAnswers(value: unknown) {
  if (Array.isArray(value)) {
    return value.length;
  }

  if (isRecord(value) && Array.isArray(value.items)) {
    return value.items.length;
  }

  return 0;
}

function hasMeaningfulValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasMeaningfulValue(item));
  }

  return value !== null && value !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function supportsAutofill(targetUrl: string | null | undefined) {
  if (!targetUrl) {
    return false;
  }

  return targetUrl.includes("greenhouse") || isMockAutofillTarget(targetUrl);
}

export function isMockAutofillTarget(targetUrl: string | null | undefined) {
  if (!targetUrl) {
    return false;
  }

  return targetUrl.includes("/mock/apply/") || targetUrl.includes("/mock/jobs/");
}

export function getAutofillActionSummary(input: {
  status: string;
  targetUrl: string | null | undefined;
}): AutofillActionSummary {
  const mockTarget = isMockAutofillTarget(input.targetUrl);

  if (input.status === "needs_user_action") {
    return mockTarget
      ? {
        label: "Open and continue",
        hint: "Opens the paused application page and reuses your saved packet in the browser.",
      }
      : {
        label: "Run autofill and open site",
        hint: "Runs live autofill in the worker, then opens the current step it reached on the site.",
      };
  }

  return mockTarget
    ? {
      label: "Open and autofill",
      hint: "Opens the application page and visibly fills it in your browser.",
    }
    : {
      label: "Run autofill and open site",
      hint: "Runs live autofill in the worker, then opens the step it reached.",
    };
}
