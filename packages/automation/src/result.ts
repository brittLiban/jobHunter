import type { ApplicationCheckpoint, ManualActionType } from "@jobhunter/core";

export type ApplyResult = {
  success: boolean;
  submitted: boolean;
  dryRun: boolean;
  source: string;
  applyUrl: string;
  confirmationText?: string;
  error?: string;
  checkpoint?: ApplicationCheckpoint | null;
  manualActionType?: ManualActionType | null;
  blockingReason?: string | null;
  filledFields: string[];
  unknownRequiredFields: string[];
  missingProfileFields: string[];
  preparedPayload: Record<string, unknown>;
  checkpointArtifacts?: Record<string, string>;
  currentUrl?: string;
};
