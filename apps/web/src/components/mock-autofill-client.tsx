"use client";

import type { StructuredApplicationDefaults } from "@jobhunter/core";
import { useEffect, useState } from "react";

type PrefillResponse = {
  applicationId: string;
  company: string;
  role: string;
  structuredDefaults: StructuredApplicationDefaults;
  generatedAnswers: Array<{
    kind: string;
    question: string;
    answer: string;
  }>;
  resume: {
    label: string;
    originalFileName: string;
    storageKey: string;
  };
};

const FIELD_BINDINGS: Array<{
  id: string;
  resolveValue: (defaults: StructuredApplicationDefaults) => string | undefined;
}> = [
  { id: "first_name", resolveValue: (defaults) => defaults.firstName },
  { id: "last_name", resolveValue: (defaults) => defaults.lastName },
  { id: "email", resolveValue: (defaults) => defaults.email },
  { id: "phone", resolveValue: (defaults) => defaults.phone },
  { id: "linkedin", resolveValue: (defaults) => defaults.linkedinUrl },
  { id: "portfolio", resolveValue: (defaults) => defaults.portfolioUrl ?? defaults.githubUrl },
  { id: "why_role", resolveValue: (defaults) => defaults.whyRole },
  { id: "why_fit", resolveValue: (defaults) => defaults.whyFit },
  { id: "anything_else", resolveValue: (defaults) => defaults.anythingElse },
] as const;

export function MockAutofillClient({
  applicationId,
  autofillRequested,
}: {
  applicationId: string | null;
  autofillRequested: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "filling" | "submitting" | "error">(
    autofillRequested ? "loading" : "idle",
  );
  const [message, setMessage] = useState(
    autofillRequested
      ? "Opening your saved packet."
      : "Use Open and autofill from JobHunter to land here with a prepared packet.",
  );
  const [filledCount, setFilledCount] = useState(0);
  const [resumeName, setResumeName] = useState<string | null>(null);

  useEffect(() => {
    if (!autofillRequested || !applicationId) {
      return;
    }

    let cancelled = false;

    async function runAutofill() {
      try {
        setStatus("loading");
        setMessage("Loading your saved profile fields, tailored answers, and resume.");

        const response = await fetch(`/api/applications/${applicationId}/prefill`, {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error("JobHunter could not load the prepared application packet.");
        }

        const payload = await response.json() as PrefillResponse;
        if (cancelled) {
          return;
        }

        const form = document.getElementById("mock-apply-form");
        if (!(form instanceof HTMLFormElement)) {
          throw new Error("The application form could not be found.");
        }

        setResumeName(payload.resume.originalFileName);
        setStatus("filling");
        setMessage(`Filling ${payload.company} with your saved application packet.`);
        await delay(300);

        const nextFilledCount = applyPreparedPacket(form, payload);
        setFilledCount(nextFilledCount);
        await delay(550);

        setStatus("submitting");
        setMessage("Fields are in place. Checking required inputs before submit.");

        if (!form.reportValidity()) {
          setStatus("error");
          setMessage("A required field is still missing, so JobHunter paused instead of guessing.");
          return;
        }

        await delay(750);
        if (cancelled) {
          return;
        }

        setMessage("Submitting the mock application now.");
        form.requestSubmit();
      } catch (error) {
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "Autofill could not complete.");
      }
    }

    void runAutofill();

    return () => {
      cancelled = true;
    };
  }, [applicationId, autofillRequested]);

  if (!applicationId && !autofillRequested) {
    return (
      <div className="app-notice app-notice-info">
        <p className="notice-title">Manual mode</p>
        <p className="notice-body">
          This page is the raw application form. Use <strong>Open and autofill</strong> in JobHunter when you want the saved packet to fill it for you.
        </p>
      </div>
    );
  }

  return (
    <div className={`mock-autofill-status app-notice ${status === "error" ? "app-notice-warning" : "app-notice-info"}`}>
      <div>
        <p className="notice-title">
          {status === "error" ? "Autofill paused" : "JobHunter browser autofill"}
        </p>
        <p className="notice-body">{message}</p>
      </div>
      <div className="mock-autofill-meta">
        <span>{filledCount} field{filledCount === 1 ? "" : "s"} filled</span>
        <span>{resumeName ? `Saved resume: ${resumeName}` : "Saved resume attaches during autofill"}</span>
      </div>
    </div>
  );
}

function applyPreparedPacket(form: HTMLFormElement, payload: PrefillResponse) {
  let filled = 0;

  for (const binding of FIELD_BINDINGS) {
    const field = form.querySelector(`#${binding.id}`);
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) {
      continue;
    }

    const value = binding.resolveValue(payload.structuredDefaults)?.trim();
    if (!value) {
      if (binding.id === "linkedin" || binding.id === "portfolio") {
        field.required = false;
      }
      continue;
    }

    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    filled += 1;
  }

  const applicationIdField = form.querySelector<HTMLInputElement>('input[name="applicationId"]');
  if (applicationIdField) {
    applicationIdField.value = payload.applicationId;
  }

  const autofillModeField = form.querySelector<HTMLInputElement>('input[name="autofillMode"]');
  if (autofillModeField) {
    autofillModeField.value = "browser_autofill";
  }

  const resumeTokenField = form.querySelector<HTMLInputElement>('input[name="resume_token"]');
  if (resumeTokenField) {
    resumeTokenField.value = payload.resume.storageKey;
  }

  const resumeNameField = form.querySelector<HTMLInputElement>('input[name="resume_name"]');
  if (resumeNameField) {
    resumeNameField.value = payload.resume.originalFileName;
  }

  const resumeInput = form.querySelector<HTMLInputElement>("#resume");
  if (resumeInput) {
    resumeInput.required = false;
  }

  form.dataset.autofilled = "true";
  return filled;
}

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
