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
      const packetResponse = await fetchWithLocalhostFallback(packetUrl, {
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
        const resumeResponse = await fetchWithLocalhostFallback(packet.resume.fileUrl, {
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
        error: toHumanErrorMessage(error),
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
        baseUrl: normalizeBaseUrl(message.baseUrl || DEFAULT_BASE_URL),
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
        baseUrl: normalizeBaseUrl(typeof raw.baseUrl === "string" ? raw.baseUrl : DEFAULT_BASE_URL),
        token: typeof raw.token === "string" ? raw.token.trim() : "",
        refreshMaterials: typeof raw.refreshMaterials === "boolean" ? raw.refreshMaterials : true,
      });
    });
  });
}

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return DEFAULT_BASE_URL;
  }

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    return `${parsed.protocol}//${parsed.host}`.replace(/\/$/, "");
  } catch {
    return DEFAULT_BASE_URL;
  }
}

async function fetchWithLocalhostFallback(url, options) {
  try {
    return await fetch(url, options);
  } catch (primaryError) {
    const fallbackUrl = toLoopbackFallbackUrl(url);
    if (!fallbackUrl) {
      throw buildNetworkError(primaryError, url, null);
    }

    try {
      return await fetch(fallbackUrl, options);
    } catch (fallbackError) {
      throw buildNetworkError(fallbackError, url, fallbackUrl);
    }
  }
}

function toLoopbackFallbackUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() !== "localhost") {
      return null;
    }
    parsed.hostname = "127.0.0.1";
    return parsed.toString();
  } catch {
    return null;
  }
}

function buildNetworkError(error, primaryUrl, fallbackUrl) {
  const message = error instanceof Error ? error.message : "Failed to fetch.";
  const parts = [
    message || "Failed to fetch.",
    `Could not reach JobHunter API at ${primaryUrl}.`,
  ];
  if (fallbackUrl) {
    parts.push(`Fallback ${fallbackUrl} also failed.`);
  }
  parts.push("Verify http://localhost:3000 is running and extension site access is allowed.");
  return new Error(parts.join(" "));
}

function toHumanErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Unknown extension error.";
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
