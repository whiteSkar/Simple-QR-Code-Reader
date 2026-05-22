const MESSAGE = Object.freeze({
  ping: "simple-qr-code-reader:ping",
  prepareScan: "simple-qr-code-reader:prepare-scan",
  processScreenshot: "simple-qr-code-reader:process-screenshot",
  copyText: "simple-qr-code-reader:copy-text",
  offscreenCopyText: "simple-qr-code-reader:offscreen-copy-text"
});

const OFFSCREEN_DOCUMENT = "offscreen.html";
let creatingOffscreenDocument;

chrome.action.onClicked.addListener((tab) => {
  scanActiveTab(tab).catch((error) => {
    console.error("QR scan failed", error);
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== MESSAGE.copyText) {
    return false;
  }

  writeToClipboard(message.text)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function scanActiveTab(tab) {
  const targetTab = typeof tab?.id === "number" ? tab : await getActiveTab();
  if (!targetTab || typeof targetTab.id !== "number") {
    throw new Error("No active tab is available for QR scanning.");
  }

  await ensureContentScript(targetTab.id);
  await chrome.tabs.sendMessage(targetTab.id, { type: MESSAGE.prepareScan });

  const imageDataUrl = await chrome.tabs.captureVisibleTab(targetTab.windowId, {
    format: "png"
  });

  await chrome.tabs.sendMessage(targetTab.id, {
    type: MESSAGE.processScreenshot,
    imageDataUrl
  });
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ensureContentScript(tabId) {
  const isReady = await pingContentScript(tabId);
  if (isReady) {
    return;
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/content.js"]
  });

  const isInjected = await pingContentScript(tabId);
  if (!isInjected) {
    throw new Error("The QR scanner content script could not be initialized.");
  }
}

async function pingContentScript(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: MESSAGE.ping });
    return Boolean(response && response.ok);
  } catch (_error) {
    return false;
  }
}

async function writeToClipboard(text) {
  if (typeof text !== "string" || text.length === 0) {
    throw new Error("Clipboard text must be a non-empty string.");
  }

  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    type: MESSAGE.offscreenCopyText,
    text
  });

  if (!response || response.ok !== true) {
    throw new Error(response && response.error ? response.error : "Clipboard write failed.");
  }
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen) {
    throw new Error("This browser does not support extension offscreen documents.");
  }

  if (await hasOffscreenDocument()) {
    return;
  }

  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT,
      reasons: ["CLIPBOARD"],
      justification: "Copy the URL decoded from the selected QR code."
    });
  }

  try {
    await creatingOffscreenDocument;
  } finally {
    creatingOffscreenDocument = null;
  }
}

async function hasOffscreenDocument() {
  if (chrome.runtime.getContexts) {
    const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT);
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    });
    return contexts.length > 0;
  }

  const clients = await self.clients.matchAll();
  return clients.some((client) => client.url === chrome.runtime.getURL(OFFSCREEN_DOCUMENT));
}
