/**
 * In-process worker state — single container, no Redis needed at this scale.
 * Tracks whether the pipeline is running and the most recent result.
 */

export type WorkerStatus = {
  running: boolean;
  lastRanAt: string | null;
  lastResult: WorkerRunSummary | null;
};

export type WorkerRunSummary = {
  discoveredJobs: number;
  scoredApplications: number;
  preparedApplications: number;
  autoSubmittedApplications: number;
  needsUserActionApplications: number;
};

let state: WorkerStatus = {
  running: false,
  lastRanAt: null,
  lastResult: null,
};

export function getWorkerStatus(): WorkerStatus {
  return { ...state };
}

export function markWorkerRunning() {
  state = { ...state, running: true, lastRanAt: new Date().toISOString() };
}

export function setWorkerResult(result: WorkerRunSummary | null) {
  state = {
    running: false,
    lastRanAt: state.lastRanAt,
    lastResult: result,
  };
}
