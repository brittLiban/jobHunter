const $ = (id) => document.getElementById(id);

const baseUrlInput       = $("baseUrl");
const tokenInput         = $("token");
const applicationIdInput = $("applicationId");
const refreshInput       = $("refreshMaterials");
const autoSubmitInput    = $("autoSubmit");
const saveBtn            = $("saveBtn");
const testBtn            = $("testBtn");
const fillBtn            = $("fillBtn");
const fillBtnText        = $("fillBtnText");
const statusBadge        = $("statusBadge");
const statusText         = $("statusText");
const statusBox          = $("statusBox");
const statusMsg          = $("statusMsg");
const stepsBox           = $("stepsBox");
const resultBox          = $("resultBox");
const jobBar             = $("jobBar");
const jobCompany         = $("jobCompany");
const jobRole            = $("jobRole");
const jobStatus          = $("jobStatus");
const connectionDetails  = $("connectionDetails");
const connectionIndicator = $("connectionIndicator");
const pageHint           = $("pageHint");
const pageHintText       = $("pageHintText");

initialize();

// ── Save ─────────────────────────────────────────────────────────────────────

saveBtn.addEventListener("click", async () => {
  await saveConfig();
  setBadge("ok", "Saved");
  showMsg("Configuration saved.", "ok");
  setTimeout(() => setBadge("idle", "Idle"), 2000);
});

// ── Test Connection ──────────────────────────────────────────────────────────

testBtn.addEventListener("click", async () => {
  setBadge("running", "Testing...");
  testBtn.disabled = true;
  await saveConfig();

  const base = normalizeBaseUrl(baseUrlInput.value);
  const token = tokenInput.value.trim();

  if (!token) {
    setBadge("error", "No token");
    showMsg("Enter an extension token first. Generate one from the web dashboard.", "error");
    testBtn.disabled = false;
    return;
  }

  try {
    const res = await fetch(`${base}/api/health`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setBadge("ok", "Connected");
      setConnectionState(true);
      showMsg(`Connected to ${base}`, "ok");
      // Auto-collapse connection section
      connectionDetails.open = false;
    } else {
      setBadge("error", `HTTP ${res.status}`);
      setConnectionState(false);
      showMsg(`Server responded with HTTP ${res.status}. Check your URL and token.`, "error");
    }
  } catch (err) {
    setBadge("error", "Unreachable");
    setConnectionState(false);
    showMsg(
      `Cannot reach the API server. Make sure it's running:\n  cd apps/web && npm run dev`,
      "error"
    );
  }

  testBtn.disabled = false;
});

// ── Autofill ─────────────────────────────────────────────────────────────────

fillBtn.addEventListener("click", async () => {
  fillBtn.disabled = true;
  saveBtn.disabled = true;
  testBtn.disabled = true;
  hideMsg();
  hideResult();
  await saveConfig();

  fillBtnText.textContent = "Running...";

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) {
    setBadge("error", "No tab");
    showMsg("No active tab found. Navigate to a job application page first.", "error");
    resetButtons();
    return;
  }

  const applicationId = applicationIdInput.value.trim();
  const refresh = refreshInput.checked;
  const autoSubmit = autoSubmitInput.checked;

  setBadge("running", "Running...");
  showSteps(refresh, autoSubmit);

  const response = await chrome.runtime.sendMessage({
    type: "JOBHUNTER_AUTOFILL_TAB",
    tabId: activeTab.id,
    applicationId,
    refreshMaterials: refresh,
    autoSubmit,
    pageUrl: activeTab.url || "",
  }).catch(() => null);

  if (!response?.ok) {
    completeStep("step-fill", "error");
    setBadge("error", "Failed");
    showMsg(
      response?.error || "Autofill failed. Check that the API server is running and you're on a job application page.",
      "error"
    );
    resetButtons();
    return;
  }

  // Show result
  const filled = Number(response.filledFieldCount || 0);
  const uploaded = Boolean(response.resumeUploaded);
  const submitted = Boolean(response.submitted);
  const unresolved = Number(response.unresolvedCount || 0);

  completeStep("step-fill", "done");
  if (autoSubmit) {
    completeStep("step-submit", submitted ? "done" : "error");
  }

  // Update result box
  $("resultFilled").textContent = filled;
  $("resultFilled").className = `result-value ${filled > 0 ? "good" : ""}`;
  $("resultResume").textContent = uploaded ? "Uploaded" : "Skipped";
  $("resultResume").className = `result-value ${uploaded ? "good" : ""}`;
  $("resultUnresolved").textContent = unresolved;
  $("resultUnresolved").className = `result-value ${unresolved > 0 ? "warn" : ""}`;
  resultBox.classList.remove("hidden");

  if (filled === 0 && !uploaded) {
    setBadge("idle", "0 filled");
    showMsg(
      `No fields were filled. ${Number(response.usableFieldCount || 0)} inputs detected. ` +
      "Make sure you're on a page with an application form.",
      "info"
    );
  } else {
    const parts = [`${filled} field${filled === 1 ? "" : "s"} filled`];
    if (uploaded) parts.push("resume uploaded");
    if (submitted) parts.push("application submitted");
    if (unresolved > 0) parts.push(`${unresolved} need manual review`);
    setBadge("ok", `${filled} filled`);
    showMsg(parts.join("  ·  "), "ok");
  }

  resetButtons();
});

// ── Initialize ───────────────────────────────────────────────────────────────

async function initialize() {
  const configRes = await chrome.runtime.sendMessage({ type: "JOBHUNTER_READ_CONFIG" });
  const config = configRes?.config || {};

  baseUrlInput.value       = config.baseUrl || "http://localhost:3000";
  tokenInput.value         = config.token || "";
  refreshInput.checked     = config.refreshMaterials !== false;
  autoSubmitInput.checked  = Boolean(config.autoSubmit);

  // Auto-collapse connection if token exists
  if (config.token) {
    connectionDetails.open = false;
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.url) return;

  // Detect application ID from URL
  const url = tryParseUrl(activeTab.url);
  const hintedId = url?.searchParams.get("jhApplicationId") || "";
  if (hintedId) {
    applicationIdInput.value = hintedId;
  }

  // Show page detection hint
  detectPageType(activeTab.url);

  // Fetch job context
  if (hintedId && config.token) {
    const base = normalizeBaseUrl(config.baseUrl || "http://localhost:3000");
    try {
      const res = await fetch(`${base}/api/applications/${hintedId}/prefill`, {
        headers: { Authorization: `Bearer ${config.token}` },
      });
      if (res.ok) {
        const data = await res.json();
        jobCompany.textContent = data.company || "\u2014";
        jobRole.textContent    = data.role || "\u2014";
        jobStatus.textContent  = data.status || "prepared";
        jobBar.classList.remove("hidden");
      }
    } catch {
      // best-effort
    }
  }

  // Quick connection check
  if (config.token) {
    const base = normalizeBaseUrl(config.baseUrl || "http://localhost:3000");
    try {
      const res = await fetch(`${base}/api/health`, {
        headers: { Authorization: `Bearer ${config.token}` },
      });
      setConnectionState(res.ok);
    } catch {
      setConnectionState(false);
    }
  }
}

function detectPageType(url) {
  if (!url) return;
  const u = url.toLowerCase();

  let hint = "";
  if (u.includes("greenhouse.io") || u.includes("greenhouse")) {
    hint = "Greenhouse form detected — full autofill support";
  } else if (u.includes("lever.co")) {
    hint = "Lever form detected";
  } else if (u.includes("ashbyhq.com")) {
    hint = "Ashby form detected";
  } else if (u.includes("myworkdayjobs") || u.includes("workday")) {
    hint = "Workday form detected — basic support";
  } else if (u.includes("/apply") || u.includes("/application") || u.includes("/careers")) {
    hint = "Application page detected";
  }

  if (hint) {
    pageHintText.textContent = hint;
    pageHint.classList.remove("hidden");
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function saveConfig() {
  return chrome.runtime.sendMessage({
    type: "JOBHUNTER_SAVE_CONFIG",
    baseUrl: normalizeBaseUrl(baseUrlInput.value || "http://localhost:3000"),
    token: tokenInput.value.trim(),
    refreshMaterials: refreshInput.checked,
    autoSubmit: autoSubmitInput.checked,
  });
}

function showSteps(refresh, autoSubmit) {
  stepsBox.classList.remove("hidden");
  setStep("step-tailor", refresh ? "running" : "skipped");
  setStep("step-fill",   refresh ? "pending" : "running");
  setStep("step-submit", autoSubmit ? "pending" : "skipped");

  // Simulate tailor completion after a moment if refresh is on
  if (refresh) {
    setTimeout(() => {
      completeStep("step-tailor", "done");
      setStep("step-fill", "running");
    }, 2000);
  }
}

function setStep(id, state) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `step step-${state}`;
  const icon = el.querySelector(".step-icon");
  if (!icon) return;

  const svgMap = {
    pending:  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/></svg>',
    running:  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 2a6 6 0 1 1-4.24 1.76" stroke-linecap="round"/></svg>',
    done:     '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path stroke-linecap="round" stroke-linejoin="round" d="M5.5 8l2 2 3-3"/></svg>',
    skipped:  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6" opacity="0.3"/><path stroke-linecap="round" d="M6 8h4"/></svg>',
    error:    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path stroke-linecap="round" d="M6 6l4 4M10 6l-4 4"/></svg>',
  };
  icon.innerHTML = svgMap[state] || svgMap.pending;
}

function completeStep(id, state) {
  setStep(id, state);
}

function resetButtons() {
  fillBtn.disabled  = false;
  saveBtn.disabled  = false;
  testBtn.disabled  = false;
  fillBtnText.textContent = "Autofill This Page";
}

function setBadge(state, text) {
  statusBadge.className = `status-badge status-${state}`;
  statusText.textContent = text;
}

function setConnectionState(connected) {
  connectionIndicator.className = `connection-indicator ${connected ? "connected" : "disconnected"}`;
}

function showMsg(msg, cls) {
  statusBox.classList.remove("hidden");
  statusMsg.textContent = msg;
  statusMsg.className = `status-msg${cls ? ` ${cls}` : ""}`;
}

function hideMsg() {
  statusBox.classList.add("hidden");
}

function hideResult() {
  resultBox.classList.add("hidden");
}

function tryParseUrl(raw) {
  try { return new URL(raw); }
  catch { return null; }
}

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "http://localhost:3000";
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.hostname === "0.0.0.0") parsed.hostname = "127.0.0.1";
    return `${parsed.protocol}//${parsed.host}`.replace(/\/$/, "");
  } catch {
    return "http://localhost:3000";
  }
}
