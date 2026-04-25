const DEFAULT_BASE_URL = "http://localhost:3000";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return false;

  (async () => {
    try {
      if (message.type === "JOBHUNTER_FETCH_PACKET") {
        const config = await readConfig();
        assertConfiguredToken(config);
        const bundle = await fetchPreparedPacket({
          config,
          applicationId: message.applicationId || "",
          pageUrl: message.pageUrl || "",
          refreshMaterials: Boolean(message.refreshMaterials),
        });
        sendResponse({ ok: true, ...bundle });
        return;
      }

      if (message.type === "JOBHUNTER_AUTOFILL_TAB") {
        const config = await readConfig();
        assertConfiguredToken(config);

        const tabId = Number(message.tabId || sender?.tab?.id || 0);
        if (!tabId) {
          sendResponse({ ok: false, error: "No tab context found for autofill." });
          return;
        }

        const pageUrl = message.pageUrl || await getTabUrl(tabId);
        const applicationId = message.applicationId || "";
        const refreshMaterials = Boolean(message.refreshMaterials);
        const autoSubmit = Boolean(message.autoSubmit);

        // Step 1: Extract form questions from the page for LLM resolution
        let formQuestions = [];
        if (applicationId) {
          try {
            const qResponse = await sendToFrame(tabId, 0, { type: "JOBHUNTER_EXTRACT_QUESTIONS" });
            if (qResponse?.ok && Array.isArray(qResponse.formQuestions)) {
              formQuestions = qResponse.formQuestions;
            }
          } catch {
            // Non-fatal
          }
        }

        // Step 2: Live-tailor (always when applicationId present; pass extracted questions)
        let fieldOverrides = {};
        if (applicationId) {
          const tailorUrl = `${config.baseUrl || DEFAULT_BASE_URL}/api/applications/${applicationId}/live-tailor`;
          try {
            const tailorResponse = await fetchWithLoopbackFallback(tailorUrl, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${config.token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ formQuestions }),
            });
            if (tailorResponse.ok) {
              const tailorData = await tailorResponse.json();
              if (tailorData?.fieldOverrides && typeof tailorData.fieldOverrides === "object") {
                fieldOverrides = tailorData.fieldOverrides;
              }
            }
          } catch {
            // Non-fatal — fall through to use existing materials
          }
        }

        // Step 3: Fetch the (now-refreshed) packet
        const bundle = await fetchPreparedPacket({
          config,
          applicationId,
          pageUrl: pageUrl || "",
          refreshMaterials: false, // already refreshed above
        });

        // Step 4: Merge LLM fieldOverrides into the packet (LLM answers take priority)
        const mergedPacket = {
          ...bundle.packet,
          fieldOverrides: {
            ...(bundle.packet?.fieldOverrides || {}),
            ...fieldOverrides,
          },
        };

        // Step 5: Apply across all frames
        const result = await applyPacketAcrossFrames({
          tabId,
          packet: mergedPacket,
          resumeFile: bundle.resumeFile,
          autoSubmit,
        });

        sendResponse(result);
        return;
      }

      if (message.type === "JOBHUNTER_SAVE_CONFIG") {
        await writeConfig({
          baseUrl: normalizeBaseUrl(message.baseUrl || DEFAULT_BASE_URL),
          token: message.token || "",
          refreshMaterials: typeof message.refreshMaterials === "boolean" ? message.refreshMaterials : true,
          autoSubmit: typeof message.autoSubmit === "boolean" ? message.autoSubmit : false,
        });
        sendResponse({ ok: true });
        return;
      }

      if (message.type === "JOBHUNTER_READ_CONFIG") {
        const config = await readConfig();
        sendResponse({ ok: true, config });
      }
    } catch (error) {
      sendResponse({ ok: false, error: toHumanErrorMessage(error) });
    }
  })();

  return true;
});

async function fetchPreparedPacket(input) {
  const params = new URLSearchParams();
  if (input.applicationId) params.set("applicationId", String(input.applicationId));
  if (input.pageUrl)       params.set("pageUrl", String(input.pageUrl));

  const packetUrl = `${input.config.baseUrl || DEFAULT_BASE_URL}/api/extension/autofill-packet?${params.toString()}`;
  const packetResponse = await fetchWithLoopbackFallback(packetUrl, {
    method: "GET",
    headers: { Authorization: `Bearer ${input.config.token}` },
  });

  if (!packetResponse.ok) {
    const text = await packetResponse.text();
    throw new Error(text || `Packet request failed (${packetResponse.status}).`);
  }

  const packet = await packetResponse.json();

  let resumeFile = null;
  const resumeUrl = resolveApiUrl(packet?.resume?.fileUrl, input.config.baseUrl);
  if (resumeUrl) {
    try {
      const resumeResponse = await fetchWithLoopbackFallback(resumeUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${input.config.token}` },
      });
      if (resumeResponse.ok) {
        const blob = await resumeResponse.blob();
        resumeFile = {
          name:     packet.resume.originalFileName || "resume",
          mimeType: packet.resume.mimeType || blob.type || "application/octet-stream",
          base64:   await blobToBase64(blob),
        };
      }
    } catch {
      // Non-fatal — proceed without resume file
    }
  }

  return { packet, resumeFile };
}

async function applyPacketAcrossFrames(input) {
  const targets = await getFrameTargets(input.tabId);
  const attempts = [];

  for (const frame of targets) {
    const response = await sendToFrame(input.tabId, frame.frameId, {
      type: "JOBHUNTER_APPLY_PACKET",
      packet: input.packet,
      resumeFile: input.resumeFile,
    });

    if (!response.ok) {
      attempts.push({ ok: false, frameUrl: frame.url, error: response.error });
      continue;
    }

    attempts.push({
      ok: true,
      frameUrl: response.frameUrl || frame.url || "",
      filledFieldCount: Number(response.filledFieldCount || 0),
      resumeUploaded:   Boolean(response.resumeUploaded),
      unresolvedCount:  Number(response.unresolvedCount || 0),
      unresolvedRequired: Array.isArray(response.unresolvedRequired) ? response.unresolvedRequired : [],
      detectedFieldCount: Number(response.detectedFieldCount || 0),
      usableFieldCount:   Number(response.usableFieldCount || 0),
    });
  }

  const success = attempts.filter((item) => item.ok);
  if (success.length === 0) {
    const firstError = attempts.find((item) => !item.ok && item.error)?.error;
    return {
      ok: false,
      error: firstError || "No fillable frame responded. Reload the page and retry.",
    };
  }

  const best = selectBestResult(success);

  // Step 4: Auto-submit if requested and fill was successful
  let submitted = false;
  if (input.autoSubmit && best.filledFieldCount > 0) {
    submitted = await tryAutoSubmitFrame(input.tabId, best.frameUrl);
  }

  return { ok: true, ...best, submitted };
}

async function tryAutoSubmitFrame(tabId, frameUrl) {
  const targets = await getFrameTargets(tabId);
  const target = targets.find((f) => f.url === frameUrl) || targets[0];
  if (!target) return false;

  const response = await sendToFrame(tabId, target.frameId, {
    type: "JOBHUNTER_AUTO_SUBMIT",
  });

  return Boolean(response?.ok && response?.submitted);
}

function selectBestResult(results) {
  return [...results].sort((a, b) => scoreResult(b) - scoreResult(a))[0];
}

function scoreResult(result) {
  return (result.filledFieldCount * 100)
    + (result.resumeUploaded ? 30 : 0)
    + Math.min(result.usableFieldCount, 50)
    + Math.min(result.detectedFieldCount, 20)
    + (result.unresolvedCount > 0 ? 5 : 0);
}

function getFrameTargets(tabId) {
  return new Promise((resolve) => {
    chrome.webNavigation.getAllFrames({ tabId }, (frames) => {
      const output = Array.isArray(frames)
        ? frames.map((f) => ({ frameId: Number(f.frameId || 0), url: String(f.url || "") }))
        : [];
      if (output.length === 0) {
        resolve([{ frameId: 0, url: "" }]);
        return;
      }
      output.sort((a, b) => framePriority(b.url, b.frameId) - framePriority(a.url, a.frameId));
      resolve(output);
    });
  });
}

function framePriority(url, frameId) {
  const n = String(url || "").toLowerCase();
  let score = frameId === 0 ? 25 : 0;
  if (n.includes("job-boards.greenhouse.io/embed/job_app")) score += 400;
  if (n.includes("greenhouse"))  score += 220;
  if (n.includes("/apply"))      score += 120;
  if (n.includes("stripe.com/jobs/listing")) score += 90;
  if (n.includes("workday") || n.includes("myworkdayjobs")) score += 80;
  if (n.includes("lever.co") || n.includes("ashbyhq.com")) score += 70;
  return score;
}

function sendToFrame(tabId, frameId, payload) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, payload, { frameId }, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        resolve({ ok: false, error: err.message || `No receiver in frame ${frameId}.` });
        return;
      }
      if (!response) {
        resolve({ ok: false, error: `No response from frame ${frameId}.` });
        return;
      }
      resolve(response);
    });
  });
}

function getTabUrl(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => resolve(tab?.url || ""));
  });
}

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return DEFAULT_BASE_URL;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.hostname === "0.0.0.0") parsed.hostname = "127.0.0.1";
    return `${parsed.protocol}//${parsed.host}`.replace(/\/$/, "");
  } catch {
    return DEFAULT_BASE_URL;
  }
}

async function fetchWithLoopbackFallback(url, options) {
  try {
    return await fetch(url, options);
  } catch (primaryError) {
    const fallbackUrl = toLoopbackFallbackUrl(url);
    if (!fallbackUrl) throw buildNetworkError(primaryError, url, null);
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
    const host = parsed.hostname.toLowerCase();
    if (host !== "localhost" && host !== "0.0.0.0") return null;
    parsed.hostname = "127.0.0.1";
    return parsed.toString();
  } catch {
    return null;
  }
}

function resolveApiUrl(rawUrl, baseUrl) {
  const candidate = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!candidate) return "";
  const base = normalizeBaseUrl(baseUrl || DEFAULT_BASE_URL);
  try {
    const parsed = new URL(candidate, `${base}/`);
    if (parsed.hostname === "0.0.0.0") parsed.hostname = "127.0.0.1";
    return parsed.toString();
  } catch {
    return "";
  }
}

function buildNetworkError(error, primaryUrl, fallbackUrl) {
  const message = error instanceof Error ? error.message : "Failed to fetch.";
  const parts = [
    message || "Failed to fetch.",
    `Could not reach JobHunter API at ${primaryUrl}.`,
  ];
  if (fallbackUrl) parts.push(`Fallback ${fallbackUrl} also failed.`);
  parts.push("Verify http://127.0.0.1:3000 is running and extension site access is allowed.");
  return new Error(parts.join(" "));
}

function assertConfiguredToken(config) {
  if (!config.token) {
    throw new Error("No extension token configured. Set it in the popup first.");
  }
}

function writeConfig(config) {
  return new Promise((resolve) => {
    chrome.storage.local.set({
      jobhunterConfig: {
        baseUrl:          normalizeBaseUrl(config.baseUrl || DEFAULT_BASE_URL),
        token:            String(config.token || "").trim(),
        refreshMaterials: typeof config.refreshMaterials === "boolean" ? config.refreshMaterials : true,
        autoSubmit:       typeof config.autoSubmit === "boolean" ? config.autoSubmit : false,
      },
    }, () => resolve());
  });
}

function readConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["jobhunterConfig"], (result) => {
      const raw = result.jobhunterConfig || {};
      resolve({
        baseUrl:          normalizeBaseUrl(typeof raw.baseUrl === "string" ? raw.baseUrl : DEFAULT_BASE_URL),
        token:            typeof raw.token === "string" ? raw.token.trim() : "",
        refreshMaterials: typeof raw.refreshMaterials === "boolean" ? raw.refreshMaterials : true,
        autoSubmit:       typeof raw.autoSubmit === "boolean" ? raw.autoSubmit : false,
      });
    });
  });
}

function toHumanErrorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  return "Unknown extension error.";
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read resume blob."));
    reader.onload  = () => {
      const result = String(reader.result || "");
      const marker = "base64,";
      const index  = result.indexOf(marker);
      resolve(index >= 0 ? result.slice(index + marker.length) : "");
    };
    reader.readAsDataURL(blob);
  });
}
