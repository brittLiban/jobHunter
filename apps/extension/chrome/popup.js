const baseUrlInput      = document.getElementById("baseUrl");
const tokenInput        = document.getElementById("token");
const applicationIdInput = document.getElementById("applicationId");
const refreshInput      = document.getElementById("refreshMaterials");
const autoSubmitInput   = document.getElementById("autoSubmit");
const saveBtn           = document.getElementById("saveBtn");
const testBtn           = document.getElementById("testBtn");
const fillBtn           = document.getElementById("fillBtn");
const statusBadge       = document.getElementById("statusBadge");
const statusText        = document.getElementById("statusText");
const statusBox         = document.getElementById("statusBox");
const statusMsg         = document.getElementById("statusMsg");
const stepsBox          = document.getElementById("stepsBox");
const jobBar            = document.getElementById("jobBar");
const jobCompany        = document.getElementById("jobCompany");
const jobRole           = document.getElementById("jobRole");
const jobStatus         = document.getElementById("jobStatus");

initialize();

saveBtn.addEventListener("click", async () => {
  await saveConfig();
  setBadge("ok", "Saved");
  showMsg("Configuration saved.", "ok");
});

testBtn.addEventListener("click", async () => {
  setBadge("running", "Testing…");
  await saveConfig();
  const base = normalizeBaseUrl(baseUrlInput.value);
  const token = tokenInput.value.trim();
  if (!token) {
    setBadge("error", "No token");
    showMsg("Set an extension token first.", "error");
    return;
  }
  try {
    const res = await fetch(`${base}/api/health`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setBadge("ok", "Connected");
      showMsg(`Connected to ${base}`, "ok");
    } else {
      setBadge("error", `HTTP ${res.status}`);
      showMsg(`Server responded with ${res.status}. Check the URL and token.`, "error");
    }
  } catch (err) {
    setBadge("error", "Unreachable");
    showMsg(`Cannot reach server: ${err instanceof Error ? err.message : "connection failed"}`, "error");
  }
});

fillBtn.addEventListener("click", async () => {
  fillBtn.disabled = true;
  saveBtn.disabled = true;
  testBtn.disabled = true;
  hideMsg();
  await saveConfig();

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) {
    setBadge("error", "No tab");
    showMsg("No active tab found.", "error");
    resetButtons();
    return;
  }

  const applicationId = applicationIdInput.value.trim();
  const refresh = refreshInput.checked;
  const autoSubmit = autoSubmitInput.checked;

  setBadge("running", "Running…");
  showSteps(refresh, autoSubmit);

  const response = await chrome.runtime.sendMessage({
    type: "JOBHUNTER_AUTOFILL_TAB",
    tabId: activeTab.id,
    applicationId,
    refreshMaterials: refresh,
    autoSubmit,
    pageUrl: activeTab.url || "",
  }).catch(() => null);

  hideSteps();

  if (!response?.ok) {
    setBadge("error", "Failed");
    showMsg(response?.error || "Autofill failed. Make sure the app is running and the token is valid.", "error");
    resetButtons();
    return;
  }

  const filled = Number(response.filledFieldCount || 0);
  const uploaded = Boolean(response.resumeUploaded);
  const submitted = Boolean(response.submitted);
  const unresolved = Number(response.unresolvedCount || 0);
  const frameHost = getHostLabel(response.frameUrl);

  if (filled === 0 && !uploaded) {
    setBadge("idle", "0 fields");
    const parts = ["No fields filled", `${Number(response.usableFieldCount || 0)} inputs detected`];
    if (frameHost) parts.push(`frame: ${frameHost}`);
    showMsg(parts.join(" · "));
  } else {
    setBadge("ok", `${filled} fields`);
    const parts = [`${filled} field${filled === 1 ? "" : "s"} filled`];
    if (uploaded) parts.push("resume uploaded");
    if (submitted) parts.push("submitted");
    if (unresolved > 0) parts.push(`${unresolved} unresolved`);
    if (frameHost) parts.push(`frame: ${frameHost}`);
    showMsg(parts.join(" · "), "ok");
  }

  resetButtons();
});

async function initialize() {
  const configRes = await chrome.runtime.sendMessage({ type: "JOBHUNTER_READ_CONFIG" });
  const config = configRes?.config || {};
  baseUrlInput.value = config.baseUrl || "http://localhost:3000";
  tokenInput.value   = config.token || "";
  refreshInput.checked    = config.refreshMaterials !== false;
  autoSubmitInput.checked = Boolean(config.autoSubmit);

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.url) return;

  const url = tryParseUrl(activeTab.url);
  const hintedId = url?.searchParams.get("jhApplicationId") || "";
  if (hintedId) {
    applicationIdInput.value = hintedId;
  }

  // Try to fetch job context for the bar
  if (hintedId && config.token) {
    const base = normalizeBaseUrl(config.baseUrl || "http://localhost:3000");
    try {
      const res = await fetch(`${base}/api/applications/${hintedId}/prefill`, {
        headers: { Authorization: `Bearer ${config.token}` },
      });
      if (res.ok) {
        const data = await res.json();
        jobCompany.textContent = data.company || "—";
        jobRole.textContent    = data.role || "—";
        jobStatus.textContent  = data.status || "prepared";
        jobBar.classList.remove("hidden");
      }
    } catch {
      // best-effort — ignore
    }
  }
}

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
}

function hideSteps() {
  stepsBox.classList.add("hidden");
  setStep("step-tailor",  "pending");
  setStep("step-fill",    "pending");
  setStep("step-submit",  "pending");
}

function setStep(id, state) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `step step-${state}`;
  const icon = el.querySelector(".step-icon");
  if (!icon) return;
  if (state === "running") icon.textContent = "↻";
  else if (state === "done") icon.textContent = "✓";
  else if (state === "skipped") icon.textContent = "—";
  else icon.textContent = "○";
}

function resetButtons() {
  fillBtn.disabled = false;
  saveBtn.disabled = false;
  testBtn.disabled = false;
}

function setBadge(state, text) {
  statusBadge.className = `status-badge status-${state}`;
  statusText.textContent = text;
}

function showMsg(msg, cls) {
  statusBox.classList.remove("hidden");
  statusMsg.textContent = msg;
  statusMsg.className = `status-msg${cls ? ` ${cls}` : ""}`;
}

function hideMsg() {
  statusBox.classList.add("hidden");
}

function getHostLabel(frameUrl) {
  try { return frameUrl ? new URL(frameUrl).host : ""; }
  catch { return ""; }
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
