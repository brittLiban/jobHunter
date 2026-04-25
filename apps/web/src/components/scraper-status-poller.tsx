"use client";

import { useEffect, useRef, useState } from "react";

type WorkerStatus = {
  running: boolean;
  lastRanAt: string | null;
  lastResult: {
    discoveredJobs: number;
    scoredApplications: number;
    preparedApplications: number;
    autoSubmittedApplications: number;
    needsUserActionApplications: number;
  } | null;
};

export function ScraperStatusPoller({ initialRunning }: { initialRunning: boolean }) {
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const wasRunning = useRef(initialRunning);
  const startedAt  = useRef<number>(initialRunning ? Date.now() : 0);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  // Elapsed seconds counter while running
  useEffect(() => {
    if (!initialRunning && !status?.running) return;
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [initialRunning, status?.running]);

  // Poll /api/worker/status every 2s
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/worker/status");
        if (!res.ok) return;
        const data: WorkerStatus = await res.json();
        setStatus(data);

        if (wasRunning.current && !data.running) {
          // Pipeline just finished — hard refresh to show results
          window.location.reload();
        }
        wasRunning.current = data.running;
      } catch { /* network blip — ignore */ }
    };

    // Start polling immediately
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, []);

  const running = status?.running ?? initialRunning;
  if (!running) return null;

  const secs = elapsed % 60;
  const mins = Math.floor(elapsed / 60);
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 999,
        background: "var(--sb-bg)",
        border: "1px solid var(--sb-border)",
        borderRadius: "var(--r-lg)",
        padding: "14px 18px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        boxShadow: "var(--shadow-lg)",
        minWidth: 260,
      }}
    >
      {/* Spinner */}
      <div style={{ position: "relative", width: 20, height: 20, flexShrink: 0 }}>
        <svg
          viewBox="0 0 20 20"
          width="20"
          height="20"
          style={{ animation: "spin 1s linear infinite", color: "var(--accent)" }}
        >
          <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="40 12" strokeLinecap="round" />
        </svg>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--sb-text)" }}>Scraper running…</div>
        <div style={{ fontSize: 11, color: "var(--sb-muted)", marginTop: 2 }}>
          Discovering and scoring jobs · {timeStr}
        </div>
      </div>

      {/* Pulsing dot */}
      <span className="sb-dot running" />

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
