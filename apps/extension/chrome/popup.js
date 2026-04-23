const baseUrlInput = document.getElementById("baseUrl");
const tokenInput = document.getElementById("token");
const applicationIdInput = document.getElementById("applicationId");
const refreshMaterialsInput = document.getElementById("refreshMaterials");
const saveConfigButton = document.getElementById("saveConfig");
const fillCurrentTabButton = document.getElementById("fillCurrentTab");
const statusNode = document.getElementById("status");

initialize();

saveConfigButton.addEventListener("click", async () => {
  setStatus("Saving config...");
  await saveConfig();
  setStatus("Saved.");
});

fillCurrentTabButton.addEventListener("click", async () => {
  setStatus("Running autofill...");
  await saveConfig();

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab || !activeTab.id) {
    setStatus("No active tab found.");
    return;
  }

  const message = {
    type: "JOBHUNTER_AUTOFILL_CURRENT_TAB",
    applicationId: (applicationIdInput.value || "").trim(),
    refreshMaterials: Boolean(refreshMaterialsInput.checked),
  };
  const response = await chrome.tabs.sendMessage(activeTab.id, message).catch(() => null);
  if (!response?.ok) {
    setStatus(response?.error || "Autofill failed on this tab.");
    return;
  }

  const details = [
    `${response.filledFieldCount || 0} fields`,
    response.resumeUploaded ? "resume uploaded" : "resume upload pending",
  ];
  if (response.unresolvedCount > 0) {
    details.push(`${response.unresolvedCount} unresolved`);
  }
  setStatus(`Done: ${details.join(" | ")}`);
});

async function initialize() {
  const configResponse = await chrome.runtime.sendMessage({
    type: "JOBHUNTER_READ_CONFIG",
  });
  const config = configResponse?.config || {};
  baseUrlInput.value = config.baseUrl || "http://localhost:3000";
  tokenInput.value = config.token || "";
  refreshMaterialsInput.checked = typeof config.refreshMaterials === "boolean"
    ? config.refreshMaterials
    : true;

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeUrl = activeTab?.url ? new URL(activeTab.url) : null;
  const hintedApplicationId = activeUrl?.searchParams.get("jhApplicationId") || "";
  if (hintedApplicationId) {
    applicationIdInput.value = hintedApplicationId;
  }
}

function saveConfig() {
  return chrome.runtime.sendMessage({
    type: "JOBHUNTER_SAVE_CONFIG",
    baseUrl: (baseUrlInput.value || "").trim() || "http://localhost:3000",
    token: (tokenInput.value || "").trim(),
    refreshMaterials: Boolean(refreshMaterialsInput.checked),
  });
}

function setStatus(message) {
  statusNode.textContent = message;
}
