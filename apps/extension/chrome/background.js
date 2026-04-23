const DEFAULT_BASE_URL = "http://localhost:3000";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "JOBHUNTER_FETCH_PACKET") {
    return false;
  }

  (async () => {
    try {
      const config = await readConfig();
      if (!config.token) {
        sendResponse({
          ok: false,
          error: "No extension token configured. Set it in the popup first.",
        });
        return;
      }

      const params = new URLSearchParams();
      if (message.applicationId) {
        params.set("applicationId", String(message.applicationId));
      }
      if (message.pageUrl) {
        params.set("pageUrl", String(message.pageUrl));
      }
      if (message.refreshMaterials) {
        params.set("refresh", "1");
      }

      const packetUrl = `${config.baseUrl || DEFAULT_BASE_URL}/api/extension/autofill-packet?${params.toString()}`;
      const packetResponse = await fetch(packetUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${config.token}`,
        },
      });
      if (!packetResponse.ok) {
        const text = await packetResponse.text();
        sendResponse({
          ok: false,
          error: text || `Packet request failed (${packetResponse.status}).`,
        });
        return;
      }
      const packet = await packetResponse.json();

      let resumeFile = null;
      if (packet?.resume?.fileUrl) {
        const resumeResponse = await fetch(packet.resume.fileUrl, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${config.token}`,
          },
        });
        if (resumeResponse.ok) {
          const blob = await resumeResponse.blob();
          resumeFile = {
            name: packet.resume.originalFileName || "resume",
            mimeType: packet.resume.mimeType || blob.type || "application/octet-stream",
            base64: await blobToBase64(blob),
          };
        }
      }

      sendResponse({
        ok: true,
        packet,
        resumeFile,
      });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown extension error.",
      });
    }
  })();

  return true;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "JOBHUNTER_SAVE_CONFIG") {
    return false;
  }

  chrome.storage.local.set(
    {
      jobhunterConfig: {
        baseUrl: message.baseUrl || DEFAULT_BASE_URL,
        token: message.token || "",
        refreshMaterials: typeof message.refreshMaterials === "boolean" ? message.refreshMaterials : true,
      },
    },
    () => {
      sendResponse({ ok: true });
    },
  );
  return true;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "JOBHUNTER_READ_CONFIG") {
    return false;
  }
  readConfig().then((config) => {
    sendResponse({
      ok: true,
      config,
    });
  });
  return true;
});

function readConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["jobhunterConfig"], (result) => {
      const raw = result.jobhunterConfig || {};
      resolve({
        baseUrl: typeof raw.baseUrl === "string" && raw.baseUrl.trim()
          ? raw.baseUrl.trim().replace(/\/$/, "")
          : DEFAULT_BASE_URL,
        token: typeof raw.token === "string" ? raw.token.trim() : "",
        refreshMaterials: typeof raw.refreshMaterials === "boolean" ? raw.refreshMaterials : true,
      });
    });
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read resume blob."));
    reader.onload = () => {
      const result = String(reader.result || "");
      const marker = "base64,";
      const index = result.indexOf(marker);
      resolve(index >= 0 ? result.slice(index + marker.length) : "");
    };
    reader.readAsDataURL(blob);
  });
}
