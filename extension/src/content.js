(function initializeSimpleQrCodeReader() {
  if (window.__simpleQrCodeReaderContent) {
    return;
  }

  const MESSAGE = Object.freeze({
    ping: "simple-qr-code-reader:ping",
    prepareScan: "simple-qr-code-reader:prepare-scan",
    processScreenshot: "simple-qr-code-reader:process-screenshot",
    copyText: "simple-qr-code-reader:copy-text"
  });

  const ROOT_ID = "simple-qr-code-reader-root";
  const TOAST_DURATION_MS = 2000;
  const MIN_MARKER_SIZE = 44;

  class QrScannerUi {
    constructor() {
      this.rootHost = null;
      this.shadowRoot = null;
      this.toastTimer = 0;
    }

    prepareForScan() {
      this.clearToast();
      this.clearMarkers();
    }

    showToast(message) {
      const root = this.getRoot();
      this.clearToast();

      const toast = document.createElement("div");
      toast.className = "simple-qr-code-reader-toast";
      toast.dataset.qrToast = "true";
      toast.setAttribute("role", "status");
      toast.textContent = message;
      root.append(toast);

      this.toastTimer = window.setTimeout(() => {
        toast.remove();
        this.toastTimer = 0;
      }, TOAST_DURATION_MS);
    }

    clearToast() {
      window.clearTimeout(this.toastTimer);
      this.toastTimer = 0;
      const root = this.getRootIfPresent();
      root?.querySelector("[data-qr-toast]")?.remove();
    }

    showMarkers(results, onSelect) {
      const root = this.getRoot();
      this.clearMarkers();

      const markerLayer = document.createElement("div");
      markerLayer.className = "simple-qr-code-reader-marker-layer";
      markerLayer.dataset.qrMarkerLayer = "true";

      results.forEach((result, index) => {
        const marker = createPressableButton(`Select QR code ${index + 1}`, () => {
          onSelect(result);
        });

        const bounds = markerBoundsForViewport(result.bounds);
        marker.className = "simple-qr-code-reader-marker";
        marker.dataset.qrMarker = "true";
        marker.dataset.qrValue = result.value;
        marker.style.left = `${bounds.left}px`;
        marker.style.top = `${bounds.top}px`;
        marker.style.width = `${bounds.width}px`;
        marker.style.height = `${bounds.height}px`;

        const label = document.createElement("span");
        label.className = "simple-qr-code-reader-marker-label";
        label.textContent = `QR ${index + 1}`;
        marker.append(label);

        markerLayer.append(marker);
      });

      root.append(markerLayer);
    }

    clearMarkers() {
      const root = this.getRootIfPresent();
      root?.querySelector("[data-qr-marker-layer]")?.remove();
    }

    getRootIfPresent() {
      return this.shadowRoot;
    }

    getRoot() {
      if (this.shadowRoot && document.documentElement.contains(this.rootHost)) {
        return this.shadowRoot;
      }

      this.rootHost = document.getElementById(ROOT_ID);
      if (!this.rootHost) {
        this.rootHost = document.createElement("div");
        this.rootHost.id = ROOT_ID;
        document.documentElement.append(this.rootHost);
      }

      if (!this.rootHost.shadowRoot) {
        this.shadowRoot = this.rootHost.attachShadow({ mode: "open" });
        this.shadowRoot.append(createStyles());
      } else {
        this.shadowRoot = this.rootHost.shadowRoot;
      }

      return this.shadowRoot;
    }
  }

  const ui = new QrScannerUi();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) {
      return false;
    }

    if (message.type === MESSAGE.ping) {
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === MESSAGE.prepareScan) {
      ui.prepareForScan();
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === MESSAGE.processScreenshot) {
      handleScreenshot(message.imageDataUrl)
        .then(() => sendResponse({ ok: true }))
        .catch((error) => {
          ui.showToast(error.message);
          sendResponse({ ok: false, error: error.message });
        });
      return true;
    }

    return false;
  });

  async function handleScreenshot(imageDataUrl) {
    ui.prepareForScan();

    const results = await decodeQrCodes(imageDataUrl);
    if (results.length === 0) {
      ui.showToast("No QR codes detected on the screen.");
      return;
    }

    if (results.length === 1) {
      await copyResult(results[0]);
      return;
    }

    ui.showMarkers(results, (result) => {
      copyResult(result).catch((error) => {
        ui.showToast(error.message);
      });
    });
  }

  async function decodeQrCodes(imageDataUrl) {
    if (!("BarcodeDetector" in window)) {
      throw new Error("QR scanning is not supported by this Chrome version.");
    }

    if (BarcodeDetector.getSupportedFormats) {
      const formats = await BarcodeDetector.getSupportedFormats();
      if (!formats.includes("qr_code")) {
        throw new Error("QR scanning is not supported by this Chrome version.");
      }
    }

    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    const response = await fetch(imageDataUrl);
    const blob = await response.blob();
    const image = await createImageBitmap(blob);

    try {
      const detectedCodes = await detector.detect(image);
      const scaleX = image.width / window.innerWidth;
      const scaleY = image.height / window.innerHeight;

      return detectedCodes
        .map((code) => toQrResult(code, scaleX, scaleY))
        .filter(Boolean);
    } finally {
      if (image.close) {
        image.close();
      }
    }
  }

  function toQrResult(code, scaleX, scaleY) {
    const value = typeof code.rawValue === "string" ? code.rawValue.trim() : "";
    if (!value) {
      return null;
    }

    const imageBounds = boundsFromBarcode(code);
    if (!imageBounds) {
      return null;
    }

    return {
      value,
      bounds: {
        left: imageBounds.left / scaleX,
        top: imageBounds.top / scaleY,
        width: imageBounds.width / scaleX,
        height: imageBounds.height / scaleY
      }
    };
  }

  function boundsFromBarcode(code) {
    if (code.boundingBox) {
      return {
        left: code.boundingBox.x,
        top: code.boundingBox.y,
        width: code.boundingBox.width,
        height: code.boundingBox.height
      };
    }

    if (!Array.isArray(code.cornerPoints) || code.cornerPoints.length === 0) {
      return null;
    }

    const xs = code.cornerPoints.map((point) => point.x);
    const ys = code.cornerPoints.map((point) => point.y);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);

    return {
      left,
      top,
      width: right - left,
      height: bottom - top
    };
  }

  async function copyResult(result) {
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE.copyText,
      text: result.value
    });

    if (!response || response.ok !== true) {
      throw new Error(response && response.error ? response.error : "Clipboard write failed.");
    }

    ui.clearMarkers();
    ui.showToast(`${result.value} is copied to clipboard`);
  }

  function markerBoundsForViewport(bounds) {
    const width = Math.max(bounds.width, MIN_MARKER_SIZE);
    const height = Math.max(bounds.height, MIN_MARKER_SIZE);
    const left = clamp(bounds.left - (width - bounds.width) / 2, 0, window.innerWidth - width);
    const top = clamp(bounds.top - (height - bounds.height) / 2, 0, window.innerHeight - height);

    return { left, top, width, height };
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), Math.max(min, max));
  }

  function createPressableButton(label, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", label);

    let pointerId = null;
    let isHeld = false;
    let wasCanceled = false;

    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }

      pointerId = event.pointerId;
      isHeld = true;
      wasCanceled = false;
      button.dataset.pressed = "true";
      button.setPointerCapture(pointerId);
      event.preventDefault();
    });

    button.addEventListener("pointermove", (event) => {
      if (event.pointerId !== pointerId || !isHeld) {
        return;
      }

      if (!isPointInside(event, button)) {
        wasCanceled = true;
        isHeld = false;
        delete button.dataset.pressed;
      }
    });

    button.addEventListener("pointerup", (event) => {
      if (event.pointerId !== pointerId) {
        return;
      }

      const shouldRun = isHeld && !wasCanceled && isPointInside(event, button);
      resetPressState(button);

      if (shouldRun) {
        action();
      }
    });

    button.addEventListener("pointercancel", () => resetPressState(button));
    button.addEventListener("lostpointercapture", () => resetPressState(button));
    button.addEventListener("click", (event) => {
      event.preventDefault();
    });

    button.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      action();
    });

    function resetPressState(target) {
      pointerId = null;
      isHeld = false;
      wasCanceled = false;
      delete target.dataset.pressed;
    }

    return button;
  }

  function isPointInside(event, element) {
    const rect = element.getBoundingClientRect();
    return (
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    );
  }

  function createStyles() {
    const style = document.createElement("style");
    style.textContent = `
      :host {
        all: initial;
      }

      .simple-qr-code-reader-toast {
        align-items: center;
        background: #202124;
        border-radius: 8px;
        box-shadow: 0 8px 24px rgba(32, 33, 36, 0.24);
        box-sizing: border-box;
        color: #fff;
        display: flex;
        font: 500 14px/20px Arial, sans-serif;
        justify-content: center;
        left: 50%;
        max-width: min(560px, calc(100vw - 32px));
        min-height: 44px;
        padding: 12px 16px;
        pointer-events: none;
        position: fixed;
        text-align: center;
        top: 24px;
        transform: translateX(-50%);
        white-space: normal;
        z-index: 2147483647;
      }

      .simple-qr-code-reader-marker-layer {
        inset: 0;
        pointer-events: none;
        position: fixed;
        z-index: 2147483646;
      }

      .simple-qr-code-reader-marker {
        align-items: center;
        background: rgba(26, 115, 232, 0.14);
        border: 4px solid #1a73e8;
        border-radius: 8px;
        box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.96), 0 8px 24px rgba(0, 0, 0, 0.22);
        box-sizing: border-box;
        color: #fff;
        cursor: pointer;
        display: flex;
        font: 700 13px/18px Arial, sans-serif;
        justify-content: center;
        margin: 0;
        padding: 8px;
        pointer-events: auto;
        position: fixed;
        text-align: center;
        touch-action: none;
      }

      .simple-qr-code-reader-marker[data-pressed="true"] {
        background: rgba(26, 115, 232, 0.24);
        border-color: #174ea6;
      }

      .simple-qr-code-reader-marker:focus-visible {
        outline: 3px solid #fbbc04;
        outline-offset: 4px;
      }

      .simple-qr-code-reader-marker-label {
        align-items: center;
        background: #1a73e8;
        border-radius: 999px;
        box-sizing: border-box;
        display: flex;
        justify-content: center;
        min-height: 24px;
        padding: 4px 8px;
      }
    `;
    return style;
  }

  window.__simpleQrCodeReaderContent = true;
})();
