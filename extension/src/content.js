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
  const DETECTION_SCALE_FACTORS = Object.freeze([1, 2, 3]);
  const MAX_DETECTION_PIXELS = 48_000_000;
  const MAX_DOM_CANDIDATES = 80;
  const DOM_DETECTION_MIN_SOURCE_SIZE = 512;
  const DOM_DETECTION_MAX_SOURCE_PIXELS = 4_000_000;
  const DETECTION_TILE_SIZE = 640;
  const DETECTION_TILE_OVERLAP = 160;
  const MAX_TILED_DETECTION_SCALE = 2;
  const DETECTION_TASK_CONCURRENCY = 3;
  const DETECTION_CACHE_TTL_MS = 5000;
  const QR_QUIET_ZONE_MODULES = 4;
  const QR_MIN_MODULE_COUNT = 21;
  const QR_MAX_MODULE_COUNT = 177;
  const QR_MODULE_COUNT_STEP = 4;
  const QR_DARK_LUMINANCE = 150;

  class QrScannerUi {
    constructor() {
      this.rootHost = null;
      this.shadowRoot = null;
      this.toastTimer = 0;
      this.markerRecords = [];
      this.nextMarkerNumber = 1;
      this.markerPositionFrame = 0;
      this.handleMarkerPositionChange = this.handleMarkerPositionChange.bind(this);
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
      this.nextMarkerNumber = 1;

      const markerLayer = document.createElement("div");
      markerLayer.className = "simple-qr-code-reader-marker-layer";
      markerLayer.dataset.qrMarkerLayer = "true";
      this.markerRecords = [];

      root.append(markerLayer);
      this.syncMarkers(results, onSelect);
      this.updateMarkerPositions();
      this.startMarkerTracking();
    }

    syncMarkers(results, onSelect) {
      const markerLayer = this.markerLayer();
      if (!markerLayer) {
        this.showMarkers(results, onSelect);
        return;
      }

      const activeResultIds = new Set(results.map((result) => result.resultId));
      this.markerRecords = this.markerRecords.filter((record) => {
        if (activeResultIds.has(record.resultId)) {
          return true;
        }

        record.marker.remove();
        return false;
      });

      results.forEach((result) => {
        const existingRecord = this.markerRecords.find((record) => record.resultId === result.resultId);
        if (existingRecord) {
          existingRecord.result = result;
          existingRecord.viewportBounds = result.visualBounds || result.bounds;
          existingRecord.anchorElement = result.anchorElement || null;
          existingRecord.anchorRelativeBounds = result.anchorRelativeBounds || null;
          existingRecord.marker.dataset.qrValue = result.value;
          return;
        }

        const markerNumber = this.nextMarkerNumber;
        this.nextMarkerNumber += 1;
        const marker = createPressableButton(`Select QR code ${markerNumber}`, () => {
          onSelect(result);
        });

        marker.className = "simple-qr-code-reader-marker";
        marker.dataset.qrMarker = "true";
        marker.dataset.qrValue = result.value;

        const label = document.createElement("span");
        label.className = "simple-qr-code-reader-marker-label";
        label.textContent = `QR ${markerNumber}`;
        marker.append(label);

        markerLayer.append(marker);
        this.markerRecords.push({
          result,
          resultId: result.resultId,
          marker,
          viewportBounds: result.visualBounds || result.bounds,
          anchorElement: result.anchorElement || null,
          anchorRelativeBounds: result.anchorRelativeBounds || null
        });
      });

      this.updateMarkerPositions();
    }

    clearMarkers() {
      this.stopMarkerTracking();
      this.markerRecords = [];
      this.nextMarkerNumber = 1;
      const root = this.getRootIfPresent();
      root?.querySelector("[data-qr-marker-layer]")?.remove();
    }

    hasMarkerLayer() {
      return Boolean(this.markerLayer());
    }

    markerLayer() {
      return this.getRootIfPresent()?.querySelector("[data-qr-marker-layer]") || null;
    }

    startMarkerTracking() {
      window.addEventListener("scroll", this.handleMarkerPositionChange, { capture: true, passive: true });
      window.addEventListener("resize", this.handleMarkerPositionChange, { passive: true });
      window.visualViewport?.addEventListener("scroll", this.handleMarkerPositionChange, { passive: true });
      window.visualViewport?.addEventListener("resize", this.handleMarkerPositionChange, { passive: true });
    }

    stopMarkerTracking() {
      window.removeEventListener("scroll", this.handleMarkerPositionChange, true);
      window.removeEventListener("resize", this.handleMarkerPositionChange);
      window.visualViewport?.removeEventListener("scroll", this.handleMarkerPositionChange);
      window.visualViewport?.removeEventListener("resize", this.handleMarkerPositionChange);
      window.cancelAnimationFrame(this.markerPositionFrame);
      this.markerPositionFrame = 0;
    }

    handleMarkerPositionChange() {
      this.scheduleMarkerPositionUpdate();
    }

    scheduleMarkerPositionUpdate() {
      if (this.markerPositionFrame) {
        return;
      }

      this.markerPositionFrame = window.requestAnimationFrame(() => {
        this.markerPositionFrame = 0;
        if (this.markerRecords.length === 0) {
          return;
        }

        this.updateMarkerPositions();
      });
    }

    updateMarkerPositions() {
      this.markerRecords.forEach((record) => {
        const anchorBounds = boundsForAnchor(record.anchorElement, record.anchorRelativeBounds);
        const viewportBounds = anchorBounds || record.viewportBounds;

        const bounds = markerBoundsForViewport(viewportBounds);
        record.marker.style.left = `${bounds.left}px`;
        record.marker.style.top = `${bounds.top}px`;
        record.marker.style.width = `${bounds.width}px`;
        record.marker.style.height = `${bounds.height}px`;
        record.marker.style.setProperty("--qr-outline-left", `${bounds.outlineLeft}px`);
        record.marker.style.setProperty("--qr-outline-top", `${bounds.outlineTop}px`);
        record.marker.style.setProperty("--qr-outline-width", `${bounds.outlineWidth}px`);
        record.marker.style.setProperty("--qr-outline-height", `${bounds.outlineHeight}px`);
      });
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
  let detectionCache = null;
  let activeScanId = 0;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) {
      return false;
    }

    if (message.type === MESSAGE.ping) {
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === MESSAGE.prepareScan) {
      activeScanId += 1;
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
    const scanId = activeScanId + 1;
    activeScanId = scanId;
    ui.prepareForScan();

    let acceptsProgressUpdates = true;
    const canUpdateUi = () => acceptsProgressUpdates && scanId === activeScanId;
    const handleSelect = (result) => {
      acceptsProgressUpdates = false;
      copyResult(result).catch((error) => {
        ui.showToast(error.message);
      });
    };
    const results = await decodeQrCodes(imageDataUrl, (currentResults) => {
      if (!canUpdateUi()) {
        return;
      }

      if (currentResults.length === 0) {
        return;
      }

      if (ui.hasMarkerLayer()) {
        ui.syncMarkers(currentResults, handleSelect);
      } else {
        ui.showMarkers(currentResults, handleSelect);
      }
    });

    if (!canUpdateUi()) {
      return;
    }

    if (results.length === 0) {
      ui.showToast("No QR codes detected on the screen.");
      return;
    }
  }

  async function decodeQrCodes(imageDataUrl, onProgress) {
    if (typeof BarcodeDetector !== "function") {
      throw new Error("QR scanning is not supported by this Chrome version.");
    }

    if (typeof BarcodeDetector.getSupportedFormats === "function") {
      const formats = await BarcodeDetector.getSupportedFormats();
      if (!formats.includes("qr_code")) {
        throw new Error("QR scanning is not supported by this Chrome version.");
      }
    }

    const cacheKey = detectionCacheKeyFor(imageDataUrl);
    const cachedResults = cachedQrResultsFor(cacheKey);
    if (cachedResults) {
      onProgress?.(cachedResults);
      return cachedResults;
    }

    const response = await fetch(imageDataUrl);
    const blob = await response.blob();
    const image = await createImageBitmap(blob);

    try {
      const results = [];
      const resultIdSequence = { next: 1 };
      const mergeProgressResults = (detectedResults) => {
        for (const detectedResult of detectedResults) {
          if (mergeQrResult(results, detectedResult, resultIdSequence)) {
            onProgress?.([...results]);
          }
        }
      };

      await mapWithConcurrency(
        detectionScaleFactorsFor(image),
        DETECTION_TASK_CONCURRENCY,
        (detectionScale) => detectQrResultsAtScale(image, detectionScale, mergeProgressResults)
      );

      mergeProgressResults(await decodeVisibleElementQrCodes());

      rememberQrResults(cacheKey, results);
      return results;
    } finally {
      if (image.close) {
        image.close();
      }
    }
  }

  async function detectQrResultsAtScale(image, detectionScale, onSourceResults) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * detectionScale);
    canvas.height = Math.round(image.height * detectionScale);
    const scaleX = (image.width * detectionScale) / window.innerWidth;
    const scaleY = (image.height * detectionScale) / window.innerHeight;
    let source = null;

    try {
      const context = createDetectionCanvasContext(canvas);
      source = canvasDetectionSource(canvas, context);
      context.imageSmoothingEnabled = false;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const fullFrameResultsPromise = detectQrResultsFromSource(source, scaleX, scaleY)
        .then((results) => {
          onSourceResults(results);
          return results;
        });
      const tileResultsPromise = detectionScale <= MAX_TILED_DETECTION_SCALE
        ? detectQrResultsInTiles(canvas, scaleX, scaleY, onSourceResults)
        : Promise.resolve([]);
      const [fullFrameResults, tileResults] = await settledValuesOrThrow([fullFrameResultsPromise, tileResultsPromise]);

      return [...fullFrameResults, ...tileResults.flat()];
    } finally {
      if (source) {
        source.close();
      } else {
        canvas.width = 0;
        canvas.height = 0;
      }
    }
  }

  async function detectQrResultsInTiles(canvas, scaleX, scaleY, onSourceResults) {
    if (canvas.width <= DETECTION_TILE_SIZE && canvas.height <= DETECTION_TILE_SIZE) {
      return [];
    }

    return mapWithConcurrency(tileBoundsForCanvas(canvas), DETECTION_TASK_CONCURRENCY, async (bounds) => {
      const tile = document.createElement("canvas");
      tile.width = bounds.width;
      tile.height = bounds.height;
      let source = null;

      try {
        const context = createDetectionCanvasContext(tile);
        source = canvasDetectionSource(tile, context);
        context.imageSmoothingEnabled = false;
        context.drawImage(
          canvas,
          bounds.left,
          bounds.top,
          bounds.width,
          bounds.height,
          0,
          0,
          bounds.width,
          bounds.height
        );

        const results = await detectQrResultsFromSource(source, scaleX, scaleY, {
          sourceOffsetLeft: bounds.left,
          sourceOffsetTop: bounds.top
        });
        onSourceResults(results);
        return results;
      } finally {
        if (source) {
          source.close();
        } else {
          tile.width = 0;
          tile.height = 0;
        }
      }
    });
  }

  async function detectQrResultsFromSource(source, scaleX, scaleY, options = {}) {
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    const detectedCodes = await detector.detect(source.imageSource);

    return detectedCodes
      .map((code) => toQrResult(code, scaleX, scaleY, {
        ...options,
        source
      }))
      .filter(Boolean);
  }

  function createDetectionCanvasContext(canvas) {
    // Chrome only honors willReadFrequently on the first 2D context creation for a canvas.
    const context = canvas.getContext("2d", {
      alpha: false,
      willReadFrequently: true
    });
    if (!context) {
      throw new Error("The QR scanner canvas context could not be created.");
    }

    return context;
  }

  function canvasDetectionSource(canvas, context = null) {
    return {
      imageSource: canvas,
      context,
      width: canvas.width,
      height: canvas.height,
      close() {
        canvas.width = 0;
        canvas.height = 0;
      }
    };
  }

  function detectionCacheKeyFor(imageDataUrl) {
    const visualViewportState = window.visualViewport
      ? `${window.visualViewport.width}:${window.visualViewport.height}:${window.visualViewport.offsetLeft}:${window.visualViewport.offsetTop}:${window.visualViewport.scale}`
      : "";

    return [
      location.href,
      window.innerWidth,
      window.innerHeight,
      window.devicePixelRatio,
      window.scrollX,
      window.scrollY,
      visualViewportState,
      imageDataUrl.length,
      hashString(imageDataUrl)
    ].join("|");
  }

  function cachedQrResultsFor(cacheKey) {
    if (!detectionCache || detectionCache.key !== cacheKey) {
      return null;
    }

    if (Date.now() - detectionCache.createdAt > DETECTION_CACHE_TTL_MS) {
      detectionCache = null;
      return null;
    }

    return detectionCache.results;
  }

  function rememberQrResults(cacheKey, results) {
    detectionCache = {
      key: cacheKey,
      createdAt: Date.now(),
      results
    };
  }

  function hashString(value) {
    let first = 0x811c9dc5;
    let second = 0x85ebca6b;

    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      first = Math.imul(first ^ code, 0x01000193);
      second = Math.imul(second ^ code, 0x27d4eb2d);
    }

    return `${first >>> 0}:${second >>> 0}`;
  }

  async function mapWithConcurrency(items, concurrency, mapper) {
    const results = new Array(items.length);
    let nextIndex = 0;
    const workerCount = Math.min(concurrency, items.length);

    await settledValuesOrThrow(Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    }));

    return results;
  }

  async function settledValuesOrThrow(promises) {
    const settledResults = await Promise.allSettled(promises);
    const rejectedResult = settledResults.find((result) => result.status === "rejected");
    if (rejectedResult) {
      throw rejectedResult.reason;
    }

    return settledResults.map((result) => result.value);
  }

  function tileBoundsForCanvas(canvas) {
    const step = DETECTION_TILE_SIZE - DETECTION_TILE_OVERLAP;
    const lefts = tileOffsetsForLength(canvas.width, step);
    const tops = tileOffsetsForLength(canvas.height, step);
    const bounds = [];

    for (const top of tops) {
      for (const left of lefts) {
        if (left === 0 && top === 0 && canvas.width <= DETECTION_TILE_SIZE && canvas.height <= DETECTION_TILE_SIZE) {
          continue;
        }

        bounds.push({
          left,
          top,
          width: Math.min(DETECTION_TILE_SIZE, canvas.width - left),
          height: Math.min(DETECTION_TILE_SIZE, canvas.height - top)
        });
      }
    }

    return bounds;
  }

  function tileOffsetsForLength(length, step) {
    if (length <= DETECTION_TILE_SIZE) {
      return [0];
    }

    const offsets = [];
    for (let offset = 0; offset < length; offset += step) {
      offsets.push(Math.min(offset, length - DETECTION_TILE_SIZE));
      if (offset >= length - DETECTION_TILE_SIZE) {
        break;
      }
    }

    return [...new Set(offsets)];
  }

  async function decodeVisibleElementQrCodes() {
    const results = [];
    const candidates = visibleQrCandidateElements();

    for (const element of candidates) {
      const source = await detectionSourceForElement(element);
      if (!source) {
        continue;
      }

      try {
        const rect = element.getBoundingClientRect();
        const scaleX = source.width / rect.width;
        const scaleY = source.height / rect.height;

        results.push(...await detectQrResultsFromSource(source, scaleX, scaleY, {
          offsetLeft: rect.left,
          offsetTop: rect.top
        }));
      } catch (_error) {
        // Some cross-origin image sources cannot be inspected. Screenshot detection still covers them.
      } finally {
        source.close();
      }
    }

    return results;
  }

  function visibleQrCandidateElements() {
    return Array.from(document.querySelectorAll("canvas,img,svg"))
      .filter(isVisibleQrCandidate)
      .slice(0, MAX_DOM_CANDIDATES);
  }

  function isVisibleQrCandidate(element) {
    if (!(element instanceof Element) || element.id === ROOT_ID || element.closest(`#${ROOT_ID}`)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8 || !rectIntersectsViewport(rect)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.visibility !== "collapse" &&
      Number(style.opacity) !== 0;
  }

  function rectIntersectsViewport(rect) {
    return rect.right > 0 &&
      rect.bottom > 0 &&
      rect.left < window.innerWidth &&
      rect.top < window.innerHeight;
  }

  async function detectionSourceForElement(element) {
    if (element instanceof HTMLCanvasElement && element.width > 0 && element.height > 0) {
      const copiedSource = copiedCanvasDetectionSource(element, element.getBoundingClientRect());
      if (copiedSource) {
        return copiedSource;
      }

      return {
        imageSource: element,
        width: element.width,
        height: element.height,
        skipPixelSampling: true,
        close() {}
      };
    }

    if (element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0 && element.naturalHeight > 0) {
      return {
        imageSource: element,
        width: element.naturalWidth,
        height: element.naturalHeight,
        close() {}
      };
    }

    if (element instanceof SVGSVGElement) {
      return svgDetectionSource(element);
    }

    return null;
  }

  function copiedCanvasDetectionSource(sourceCanvas, rect) {
    const sourceSize = detectionSourceSizeForRect(rect);
    const canvas = document.createElement("canvas");
    canvas.width = sourceSize.width;
    canvas.height = sourceSize.height;

    try {
      const context = createDetectionCanvasContext(canvas);
      context.imageSmoothingEnabled = false;
      context.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
      return canvasDetectionSource(canvas, context);
    } catch (_error) {
      canvas.width = 0;
      canvas.height = 0;
      return null;
    }
  }

  async function svgDetectionSource(svg) {
    const rect = svg.getBoundingClientRect();
    const sourceSize = detectionSourceSizeForRect(rect);
    const clone = svg.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(sourceSize.width));
    clone.setAttribute("height", String(sourceSize.height));

    const svgText = new XMLSerializer().serializeToString(clone);
    const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`);
    const canvas = document.createElement("canvas");
    canvas.width = sourceSize.width;
    canvas.height = sourceSize.height;

    const context = createDetectionCanvasContext(canvas);
    context.imageSmoothingEnabled = false;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    return canvasDetectionSource(canvas, context);
  }

  function detectionSourceSizeForRect(rect) {
    const smallestSide = Math.max(1, Math.min(rect.width, rect.height));
    const scale = Math.max(1, DOM_DETECTION_MIN_SOURCE_SIZE / smallestSide);
    let width = Math.round(rect.width * scale);
    let height = Math.round(rect.height * scale);
    const pixels = width * height;

    if (pixels > DOM_DETECTION_MAX_SOURCE_PIXELS) {
      const downscale = Math.sqrt(DOM_DETECTION_MAX_SOURCE_PIXELS / pixels);
      width = Math.max(1, Math.round(width * downscale));
      height = Math.max(1, Math.round(height * downscale));
    }

    return { width, height };
  }

  function loadImage(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("The SVG QR candidate could not be rendered."));
      image.src = source;
    });
  }

  function detectionScaleFactorsFor(image) {
    const imagePixels = image.width * image.height;
    return DETECTION_SCALE_FACTORS.filter((scale) => {
      return imagePixels * scale * scale <= MAX_DETECTION_PIXELS;
    });
  }

  function mergeQrResult(results, result, resultIdSequence) {
    const existingIndex = results.findIndex((candidate) => isSameQrResult(candidate, result));
    if (existingIndex === -1) {
      result.resultId = `qr-result-${resultIdSequence.next}`;
      resultIdSequence.next += 1;
      results.push(result);
      return true;
    }

    const currentResult = results[existingIndex];
    if (isPreferredQrResult(result, currentResult)) {
      result.resultId = currentResult.resultId;
      results[existingIndex] = result;
      return true;
    }

    return false;
  }

  function isSameQrResult(first, second) {
    if (first.value !== second.value) {
      return false;
    }

    const firstCenter = centerOfBounds(first.bounds);
    const secondCenter = centerOfBounds(second.bounds);
    const maxQrSize = Math.max(first.bounds.width, first.bounds.height, second.bounds.width, second.bounds.height);
    return Math.abs(firstCenter.x - secondCenter.x) <= maxQrSize / 2 &&
      Math.abs(firstCenter.y - secondCenter.y) <= maxQrSize / 2;
  }

  function isPreferredQrResult(candidate, current) {
    if (candidate.anchorElement && !current.anchorElement) {
      return true;
    }

    if (!candidate.anchorElement && current.anchorElement) {
      return false;
    }

    if ((candidate.visualBoundsQuality || 0) > (current.visualBoundsQuality || 0)) {
      return true;
    }

    return false;
  }

  function centerOfBounds(bounds) {
    return {
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2
    };
  }

  function toQrResult(code, scaleX, scaleY, options = {}) {
    const value = typeof code.rawValue === "string" ? code.rawValue.trim() : "";
    if (!value) {
      return null;
    }

    const imageBounds = boundsFromBarcode(code);
    if (!imageBounds) {
      return null;
    }

    const viewportBounds = sourceBoundsToViewportBounds(imageBounds, scaleX, scaleY, options);
    const visualImageBounds = visualBoundsFromBarcode(imageBounds, options.source);
    const visualViewportBounds = sourceBoundsToViewportBounds(visualImageBounds.bounds, scaleX, scaleY, options);

    const renderedAnchor = resolveRenderedQrAnchor(visualViewportBounds);

    return {
      value,
      bounds: viewportBounds,
      visualBounds: visualViewportBounds,
      visualBoundsQuality: visualImageBounds.quality * 1000 + Math.min(scaleX, scaleY),
      anchorElement: renderedAnchor.element,
      anchorRelativeBounds: renderedAnchor.relativeBounds
    };
  }

  function sourceBoundsToViewportBounds(bounds, scaleX, scaleY, options) {
    const sourceOffsetLeft = options.sourceOffsetLeft || 0;
    const sourceOffsetTop = options.sourceOffsetTop || 0;

    return {
      left: (bounds.left + sourceOffsetLeft) / scaleX + (options.offsetLeft || 0),
      top: (bounds.top + sourceOffsetTop) / scaleY + (options.offsetTop || 0),
      width: bounds.width / scaleX,
      height: bounds.height / scaleY
    };
  }

  function visualBoundsFromBarcode(decodedBounds, source) {
    const sampler = pixelSamplerForSource(source);
    if (!sampler) {
      return {
        bounds: decodedBounds,
        quality: 0
      };
    }

    const directModuleCount = estimateQrModuleCount(decodedBounds, sampler);
    if (directModuleCount) {
      const quietX = decodedBounds.width * QR_QUIET_ZONE_MODULES / directModuleCount;
      const quietY = decodedBounds.height * QR_QUIET_ZONE_MODULES / directModuleCount;
      const expandedBounds = expandByQuietZone(decodedBounds, quietX, quietY, source);

      return {
        bounds: expandedBounds.bounds,
        quality: expandedBounds.clipped ? 2 : 3
      };
    }

    const qrMatrixBounds = qrMatrixBoundsFromPixels(decodedBounds, source, sampler) || decodedBounds;
    const moduleCount = estimateQrModuleCount(qrMatrixBounds, sampler) || QR_MIN_MODULE_COUNT;
    const quietX = qrMatrixBounds.width * QR_QUIET_ZONE_MODULES / moduleCount;
    const quietY = qrMatrixBounds.height * QR_QUIET_ZONE_MODULES / moduleCount;
    const expandedBounds = expandByQuietZone(qrMatrixBounds, quietX, quietY, source);
    return {
      bounds: expandedBounds.bounds,
      quality: qrMatrixBounds === decodedBounds ? 1 : 2
    };
  }

  function expandByQuietZone(bounds, quietX, quietY, source) {
    const left = bounds.left - quietX;
    const top = bounds.top - quietY;
    const right = bounds.left + bounds.width + quietX;
    const bottom = bounds.top + bounds.height + quietY;
    const clippedLeft = clamp(left, 0, source.width);
    const clippedTop = clamp(top, 0, source.height);
    const clippedRight = clamp(right, 0, source.width);
    const clippedBottom = clamp(bottom, 0, source.height);

    return {
      bounds: {
        left: clippedLeft,
        top: clippedTop,
        width: clippedRight - clippedLeft,
        height: clippedBottom - clippedTop
      },
      clipped: clippedLeft !== left ||
        clippedTop !== top ||
        clippedRight !== right ||
        clippedBottom !== bottom
    };
  }

  function pixelSamplerForSource(source) {
    if (!source || source.skipPixelSampling || !(source.imageSource instanceof HTMLCanvasElement)) {
      return null;
    }

    try {
      const context = source.context || source.imageSource.getContext("2d", { willReadFrequently: true });
      if (!context) {
        return null;
      }

      return {
        luminanceAt(x, y) {
          const sampleX = clamp(Math.round(x), 0, source.width - 1);
          const sampleY = clamp(Math.round(y), 0, source.height - 1);
          const [red, green, blue] = context.getImageData(sampleX, sampleY, 1, 1).data;
          return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
        }
      };
    } catch (_error) {
      return null;
    }
  }

  function qrMatrixBoundsFromPixels(decodedBounds, source, sampler) {
    const searchPadding = Math.max(decodedBounds.width, decodedBounds.height) * 0.75;
    const roi = {
      left: Math.max(0, Math.floor(decodedBounds.left - searchPadding)),
      top: Math.max(0, Math.floor(decodedBounds.top - searchPadding)),
      right: Math.min(source.width - 1, Math.ceil(decodedBounds.left + decodedBounds.width + searchPadding)),
      bottom: Math.min(source.height - 1, Math.ceil(decodedBounds.top + decodedBounds.height + searchPadding))
    };
    const width = roi.right - roi.left + 1;
    const height = roi.bottom - roi.top + 1;
    if (width <= 0 || height <= 0 || width * height > 250_000) {
      return null;
    }

    const darkMask = new Uint8Array(width * height);
    const joinedMask = new Uint8Array(width * height);
    const bridgeRadius = Math.max(2, Math.min(8, Math.round(Math.min(decodedBounds.width, decodedBounds.height) / 18)));
    const seedIndices = [];

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const sourceX = roi.left + x;
        const sourceY = roi.top + y;
        if (sampler.luminanceAt(sourceX, sourceY) >= QR_DARK_LUMINANCE) {
          continue;
        }

        const index = y * width + x;
        darkMask[index] = 1;
        markJoinedNeighborhood(joinedMask, width, height, x, y, bridgeRadius);

        if (pointInsideBounds(sourceX, sourceY, decodedBounds)) {
          seedIndices.push(index);
        }
      }
    }

    if (seedIndices.length === 0) {
      return null;
    }

    const visited = new Uint8Array(width * height);
    const queue = [];
    for (const seedIndex of seedIndices) {
      if (!joinedMask[seedIndex] || visited[seedIndex]) {
        continue;
      }

      visited[seedIndex] = 1;
      queue.push(seedIndex);
    }

    if (queue.length === 0) {
      return null;
    }

    let cursor = 0;
    while (cursor < queue.length) {
      const index = queue[cursor];
      cursor += 1;
      const x = index % width;
      const y = Math.floor(index / width);

      for (const [nextX, nextY] of neighborPixels(x, y)) {
        if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
          continue;
        }

        const nextIndex = nextY * width + nextX;
        if (!joinedMask[nextIndex] || visited[nextIndex]) {
          continue;
        }

        visited[nextIndex] = 1;
        queue.push(nextIndex);
      }
    }

    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (!darkMask[index] || !visited[index]) {
          continue;
        }

        const sourceX = roi.left + x;
        const sourceY = roi.top + y;
        left = Math.min(left, sourceX);
        top = Math.min(top, sourceY);
        right = Math.max(right, sourceX);
        bottom = Math.max(bottom, sourceY);
      }
    }

    if (!Number.isFinite(left) || !isPlausibleQrMatrixBounds(left, top, right, bottom, decodedBounds)) {
      return null;
    }

    return {
      left,
      top,
      width: right - left + 1,
      height: bottom - top + 1
    };
  }

  function markJoinedNeighborhood(mask, width, height, x, y, radius) {
    const left = Math.max(0, x - radius);
    const top = Math.max(0, y - radius);
    const right = Math.min(width - 1, x + radius);
    const bottom = Math.min(height - 1, y + radius);

    for (let nextY = top; nextY <= bottom; nextY += 1) {
      for (let nextX = left; nextX <= right; nextX += 1) {
        mask[nextY * width + nextX] = 1;
      }
    }
  }

  function pointInsideBounds(x, y, bounds) {
    return x >= bounds.left &&
      x <= bounds.left + bounds.width &&
      y >= bounds.top &&
      y <= bounds.top + bounds.height;
  }

  function neighborPixels(x, y) {
    return [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1]
    ];
  }

  function isPlausibleQrMatrixBounds(left, top, right, bottom, decodedBounds) {
    const width = right - left + 1;
    const height = bottom - top + 1;
    const aspectRatio = width / height;
    const decodedCenter = centerOfBounds(decodedBounds);

    return aspectRatio >= 0.72 &&
      aspectRatio <= 1.28 &&
      width >= decodedBounds.width * 0.75 &&
      height >= decodedBounds.height * 0.75 &&
      decodedCenter.x >= left &&
      decodedCenter.x <= right &&
      decodedCenter.y >= top &&
      decodedCenter.y <= bottom;
  }

  function estimateQrModuleCount(decodedBounds, sampler) {
    let bestModuleCount = null;
    let bestScore = -Infinity;

    for (let moduleCount = QR_MIN_MODULE_COUNT; moduleCount <= QR_MAX_MODULE_COUNT; moduleCount += QR_MODULE_COUNT_STEP) {
      const moduleWidth = decodedBounds.width / moduleCount;
      const moduleHeight = decodedBounds.height / moduleCount;
      if (moduleWidth < 0.75 || moduleHeight < 0.75) {
        continue;
      }

      const score = scoreFinderPatternCandidate(sampler, decodedBounds, moduleCount);
      if (score > bestScore) {
        bestScore = score;
        bestModuleCount = moduleCount;
      }
    }

    return bestScore >= 28 ? bestModuleCount : null;
  }

  function scoreFinderPatternCandidate(sampler, bounds, moduleCount) {
    const darkSamples = [
      ...rowModules(0, 6, 0),
      ...columnModules(0, 6, 0),
      ...rowModules(moduleCount - 7, moduleCount - 1, 0),
      ...columnModules(0, 6, moduleCount - 1),
      ...columnModules(moduleCount - 7, moduleCount - 1, 0),
      ...rowModules(0, 6, moduleCount - 1)
    ];
    const lightSamples = [
      [7, 0],
      [0, 7],
      [moduleCount - 8, 0],
      [moduleCount - 1, 7],
      [0, moduleCount - 8],
      [7, moduleCount - 1]
    ];

    let score = 0;
    for (const [moduleX, moduleY] of darkSamples) {
      score += scoreDarkSample(sampleModuleLuminance(sampler, bounds, moduleCount, moduleX, moduleY));
    }

    for (const [moduleX, moduleY] of lightSamples) {
      score += scoreLightSample(sampleModuleLuminance(sampler, bounds, moduleCount, moduleX, moduleY));
    }

    return score;
  }

  function rowModules(start, end, row) {
    return range(start, end).map((moduleX) => [moduleX, row]);
  }

  function columnModules(start, end, column) {
    return range(start, end).map((moduleY) => [column, moduleY]);
  }

  function range(start, end) {
    return Array.from({ length: end - start + 1 }, (_value, index) => start + index);
  }

  function sampleModuleLuminance(sampler, bounds, moduleCount, moduleX, moduleY) {
    const moduleWidth = bounds.width / moduleCount;
    const moduleHeight = bounds.height / moduleCount;
    return sampler.luminanceAt(
      bounds.left + (moduleX + 0.5) * moduleWidth,
      bounds.top + (moduleY + 0.5) * moduleHeight
    );
  }

  function scoreDarkSample(luminance) {
    if (luminance < 120) {
      return 2;
    }

    if (luminance < 170) {
      return 0.5;
    }

    return -2;
  }

  function scoreLightSample(luminance) {
    if (luminance > 180) {
      return 2;
    }

    if (luminance > 130) {
      return 0.5;
    }

    return -2;
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

  function resolveRenderedQrAnchor(detectedBounds) {
    const renderedElement = renderedQrElementAtCenter(detectedBounds);
    if (!renderedElement) {
      return { element: null, relativeBounds: null };
    }

    const renderedBounds = renderedElement.getBoundingClientRect();
    if (!isUsableRenderedAnchor(renderedBounds, detectedBounds)) {
      return { element: null, relativeBounds: null };
    }

    return {
      element: renderedElement,
      relativeBounds: relativeBoundsForAnchor(renderedBounds, detectedBounds)
    };
  }

  function boundsForAnchor(anchorElement, relativeBounds) {
    if (!(anchorElement instanceof Element) || !anchorElement.isConnected || !relativeBounds) {
      return null;
    }

    const anchorBounds = rectToBounds(anchorElement.getBoundingClientRect());
    if (anchorBounds.width <= 0 || anchorBounds.height <= 0) {
      return null;
    }

    return {
      left: anchorBounds.left + anchorBounds.width * relativeBounds.left,
      top: anchorBounds.top + anchorBounds.height * relativeBounds.top,
      width: anchorBounds.width * relativeBounds.width,
      height: anchorBounds.height * relativeBounds.height
    };
  }

  function relativeBoundsForAnchor(anchorBounds, detectedBounds) {
    return {
      left: (detectedBounds.left - anchorBounds.left) / anchorBounds.width,
      top: (detectedBounds.top - anchorBounds.top) / anchorBounds.height,
      width: detectedBounds.width / anchorBounds.width,
      height: detectedBounds.height / anchorBounds.height
    };
  }

  function rectToBounds(rect) {
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    };
  }

  function renderedQrElementAtCenter(bounds) {
    const centerX = clamp(bounds.left + bounds.width / 2, 0, window.innerWidth - 1);
    const centerY = clamp(bounds.top + bounds.height / 2, 0, window.innerHeight - 1);
    const elements = document.elementsFromPoint(centerX, centerY);

    for (const element of elements) {
      const renderedElement = closestRenderedQrElement(element);
      if (renderedElement) {
        return renderedElement;
      }
    }

    return null;
  }

  function closestRenderedQrElement(element) {
    if (!(element instanceof Element) || element.id === ROOT_ID || element.closest(`#${ROOT_ID}`)) {
      return null;
    }

    const candidate = element.closest("svg,img,canvas,picture");
    if (!candidate) {
      return null;
    }

    if (candidate.tagName.toLowerCase() === "picture") {
      return candidate.querySelector("img");
    }

    return candidate;
  }

  function isUsableRenderedAnchor(renderedBounds, detectedBounds) {
    if (renderedBounds.width <= 0 || renderedBounds.height <= 0) {
      return false;
    }

    const detectedCenterX = detectedBounds.left + detectedBounds.width / 2;
    const detectedCenterY = detectedBounds.top + detectedBounds.height / 2;
    const containsDetectedCenter =
      detectedCenterX >= renderedBounds.left &&
      detectedCenterX <= renderedBounds.right &&
      detectedCenterY >= renderedBounds.top &&
      detectedCenterY <= renderedBounds.bottom;

    if (!containsDetectedCenter) {
      return false;
    }

    return true;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function markerBoundsForViewport(bounds) {
    const width = Math.max(bounds.width, MIN_MARKER_SIZE);
    const height = Math.max(bounds.height, MIN_MARKER_SIZE);
    const left = bounds.left - (width - bounds.width) / 2;
    const top = bounds.top - (height - bounds.height) / 2;

    return {
      left,
      top,
      width,
      height,
      outlineLeft: (width - bounds.width) / 2,
      outlineTop: (height - bounds.height) / 2,
      outlineWidth: bounds.width,
      outlineHeight: bounds.height
    };
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
        bottom: 0;
        height: auto;
        left: 0;
        overflow: visible;
        pointer-events: none;
        position: fixed;
        right: 0;
        top: 0;
        width: auto;
        z-index: 2147483646;
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
        bottom: 0;
        height: auto;
        left: 0;
        overflow: visible;
        pointer-events: none;
        position: fixed;
        right: 0;
        top: 0;
        width: auto;
      }

      .simple-qr-code-reader-marker {
        align-items: center;
        background: transparent;
        border: 0;
        border-radius: 0;
        box-shadow: none;
        box-sizing: border-box;
        color: #fff;
        cursor: pointer;
        display: flex;
        font: 700 13px/18px Arial, sans-serif;
        justify-content: center;
        margin: 0;
        padding: 8px;
        pointer-events: auto;
        position: absolute;
        text-align: center;
        touch-action: none;
      }

      .simple-qr-code-reader-marker::before {
        background: rgba(26, 115, 232, 0.14);
        border: 4px solid #1a73e8;
        border-radius: 8px;
        box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.96), 0 8px 24px rgba(0, 0, 0, 0.22);
        box-sizing: border-box;
        content: "";
        height: var(--qr-outline-height, 100%);
        left: var(--qr-outline-left, 0);
        pointer-events: none;
        position: absolute;
        top: var(--qr-outline-top, 0);
        width: var(--qr-outline-width, 100%);
      }

      .simple-qr-code-reader-marker[data-pressed="true"]::before {
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
        position: relative;
      }
    `;
    return style;
  }

  window.__simpleQrCodeReaderContent = true;
})();
