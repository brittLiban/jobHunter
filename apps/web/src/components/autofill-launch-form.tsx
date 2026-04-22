"use client";

import { useState } from "react";

export function AutofillLaunchForm({
  applicationId,
  label,
  fullWidth = false,
}: {
  applicationId: string;
  label: string;
  fullWidth?: boolean;
}) {
  const [pending, setPending] = useState(false);

  return (
    <form
      action={`/api/applications/${applicationId}/autofill`}
      method="post"
      onSubmit={() => setPending(true)}
    >
      <button
        type="submit"
        className={`button button-primary ${fullWidth ? "button-full" : ""}`}
        disabled={pending}
      >
        {pending ? "Starting autofill..." : label}
      </button>
    </form>
  );
}
