import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { access, mkdir, readFile, rm } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const extensionDir = path.join(projectRoot, "extension");
const manifestPath = path.join(extensionDir, "manifest.json");
const contentScriptPath = path.join(extensionDir, "src", "content.js");
const fixturesDir = path.join(projectRoot, "tests", "fixtures");
const defaultChromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const toastDurationMs = 2000;
const harnessMessageTimeoutMs = 20000;
const requireExtensionWorker = process.env.REQUIRE_EXTENSION_WORKER === "1";

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"]
]);

async function main() {
  const chromePath = process.env.CHROME_PATH || await testBrowserPath();
  const server = await startFixtureServer();
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const userDataDir = path.join(tmpdir(), `simple-qr-code-reader-${Date.now()}`);
  await mkdir(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: chromePath,
    headless: false,
    ignoreDefaultArgs: [
      "--disable-extensions",
      "--disable-component-extensions-with-background-pages"
    ],
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      "--enable-extensions"
    ]
  });

  try {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: baseUrl
    });

    await runTest("shortcut title and command are declared", async () => {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      const scanCommand = manifest.commands._execute_action;

      assert.equal(manifest.action.default_title, "Scan QR code (Option+Shift+Q)");
      assert.ok(scanCommand, "Expected _execute_action command to be declared.");
      assert.equal(scanCommand.suggested_key.default, "Alt+Shift+Q");
      assert.equal(scanCommand.suggested_key.mac, "Option+Shift+Q");
      assert.equal(scanCommand.description, "Scan visible tab for QR codes (Option+Shift+Q)");
    });

    await runTest("shortcut title and command are assigned in Chrome", async () => {
      const worker = await extensionWorker(context);
      if (!worker) {
        console.warn("WARN Extension service worker unavailable; skipping runtime shortcut assignment check.");
        return;
      }

      const info = await worker.evaluate(async () => {
        const commands = await chrome.commands.getAll();
        return {
          actionTitle: await chrome.action.getTitle({}),
          commands
        };
      });
      const scanCommand = info.commands.find((command) => command.name === "_execute_action");

      assert.equal(info.actionTitle, "Scan QR code (Option+Shift+Q)");
      assert.ok(scanCommand, "Expected _execute_action command to be assigned.");
      assert.match(scanCommand.shortcut, /^(?:(?:Alt|Option)\+Shift\+Q|\u2325\u21e7Q)$/u);
    });

    await runTest("detection canvases request frequent readback on first context", async () => {
      const page = await openFixture(context, baseUrl, "embedded-canvas.html");

      await installCanvasContextRecorder(page);
      await installContentHarness(page);
      await invokeContentHarness(page);
      await waitForMarkerCount(page, 1);

      const records = await canvasContextRecords(page);
      assert.ok(records.length > 0, "Expected the scan to create canvas contexts.");
      assert.equal(
        records.some((record) => record.canvasId === "embedded-qr"),
        false,
        "Expected loaded page canvases not to be sampled directly by the content script."
      );
      assert.deepEqual(
        records.filter((record) => !record.willReadFrequently),
        [],
        "Expected every scanner-created canvas to request willReadFrequently on first context creation."
      );
      await page.close();
    });

    await runTest("single QR is marked before google.com is copied", async () => {
      const page = await openFixture(context, baseUrl, "single.html");
      await writeClipboard(page, "before-single");

      await invokeExtensionScan(context, page);
      await waitForMarkerCount(page, 1);

      assert.equal(await readClipboard(page), "before-single");
      const marker = await readMarker(page, "google.com");
      await page.mouse.click(marker.centerX, marker.centerY);

      await waitForToast(page, "google.com is copied to clipboard");
      assert.equal(await readClipboard(page), "google.com");
      await waitForToastToDisappear(page);
      await page.close();
    });

    await runTest("tiny QR is marked before google.com is copied", async () => {
      const page = await openFixture(context, baseUrl, "tiny.html");
      await writeClipboard(page, "before-tiny");

      await invokeExtensionScan(context, page);
      await waitForMarkerCount(page, 1);

      assert.equal(await readClipboard(page), "before-tiny");
      const marker = await readMarker(page, "google.com");
      await page.mouse.click(marker.centerX, marker.centerY);

      await waitForToast(page, "google.com is copied to clipboard");
      assert.equal(await readClipboard(page), "google.com");
      await waitForToastToDisappear(page);
      await page.close();
    });

    await runTest("micro SVG QR is marked before google.com is copied", async () => {
      const page = await openFixture(context, baseUrl, "micro-svg.html");
      await writeClipboard(page, "before-micro");

      await invokeExtensionScan(context, page);
      await waitForMarkerCount(page, 1);

      assert.equal(await readClipboard(page), "before-micro");
      const marker = await readMarker(page, "google.com");
      await page.mouse.click(marker.centerX, marker.centerY);

      await waitForToast(page, "google.com is copied to clipboard");
      assert.equal(await readClipboard(page), "google.com");
      await waitForToastToDisappear(page);
      await page.close();
    });

    await runTest("keyboard activation copies the selected QR code", async () => {
      const page = await openFixture(context, baseUrl, "single.html");
      await writeClipboard(page, "before-keyboard");

      await invokeExtensionScan(context, page);
      await waitForMarkerCount(page, 1);
      await focusMarker(page, "google.com");
      await page.keyboard.press("Enter");

      await waitForToast(page, "google.com is copied to clipboard");
      assert.equal(await readClipboard(page), "google.com");
      await waitForToastToDisappear(page);
      await page.close();
    });

    await runTest("repeated micro QR scans keep detecting the same code", async () => {
      const page = await openFixture(context, baseUrl, "micro-svg.html");
      await installContentHarness(page);

      for (let attempt = 0; attempt < 8; attempt += 1) {
        await invokeContentHarness(page);
        await waitForMarkerCount(page, 1);
        assert.deepEqual(await markerValues(page), ["google.com"]);
      }

      await page.close();
    });

    await runTest("missing BarcodeDetector shows an auto-dismissed unsupported message", async () => {
      const page = await openFixture(context, baseUrl, "single.html");
      await installMissingBarcodeDetector(page);
      await installContentHarness(page);

      const response = await invokeContentHarness(page, { allowFailure: true });

      assert.equal(response.ok, false);
      assert.equal(response.error, "QR scanning is not supported by this Chrome version.");
      await waitForToast(page, "QR scanning is not supported by this Chrome version.");
      assert.equal(await markerCount(page), 0);
      await waitForToastToDisappear(page);
      await page.close();
    });

    await runTest("unsupported BarcodeDetector formats show an auto-dismissed unsupported message", async () => {
      const page = await openFixture(context, baseUrl, "single.html");
      await installUnsupportedBarcodeDetectorFormats(page);
      await installContentHarness(page);

      const response = await invokeContentHarness(page, { allowFailure: true });

      assert.equal(response.ok, false);
      assert.equal(response.error, "QR scanning is not supported by this Chrome version.");
      await waitForToast(page, "QR scanning is not supported by this Chrome version.");
      assert.equal(await markerCount(page), 0);
      await waitForToastToDisappear(page);
      await page.close();
    });

    await runTest("clipboard failure leaves clipboard unchanged and shows an auto-dismissed error", async () => {
      const page = await openFixture(context, baseUrl, "single.html");
      await writeClipboard(page, "before-copy-failure");
      await installContentHarness(page);
      await installCopyFailure(page, "Simulated clipboard failure.");

      await invokeContentHarness(page);
      await waitForMarkerCount(page, 1);
      const marker = await readMarker(page, "google.com");
      await page.mouse.click(marker.centerX, marker.centerY);

      await waitForToast(page, "Simulated clipboard failure.");
      assert.equal(await readClipboard(page), "before-copy-failure");
      assert.equal(await markerCount(page), 1);
      await waitForToastToDisappear(page);
      await page.close();
    });

    await runTest("QR markers appear incrementally before the full scan completes", async () => {
      const page = await openFixture(context, baseUrl, "single.html");
      await installContentHarness(page);
      await installBarcodeDetectorDelayAfterFirstSuccess(page, 800);

      const scanPromise = invokeContentHarness(page);
      const markerAppearedBeforeScanCompleted = await Promise.race([
        scanPromise.then(() => false),
        waitForMarkerCount(page, 1).then(() => true)
      ]);
      assert.equal(markerAppearedBeforeScanCompleted, true, "Expected the first marker to render while slower detector tasks were still pending.");

      await scanPromise;
      await waitForMarkerCount(page, 1);
      await page.close();
    });

    await runTest("selecting an incremental marker prevents late scan updates from recreating markers", async () => {
      const page = await openFixture(context, baseUrl, "single.html");
      await installContentHarness(page);
      await installBarcodeDetectorDelayAfterFirstSuccess(page, 800);

      const scanPromise = invokeContentHarness(page);
      await waitForMarkerCount(page, 1);

      const marker = await readMarker(page, "google.com");
      await page.mouse.click(marker.centerX, marker.centerY);
      await waitForToast(page, "google.com is copied to clipboard");
      assert.equal(await readClipboard(page), "google.com");

      await scanPromise;
      assert.equal(await markerCount(page), 0);
      await page.close();
    });

    await runTest("new scan ignores stale no-code result from an older scan", async () => {
      const page = await openFixture(context, baseUrl, "single.html");
      await installContentHarness(page);
      await installBarcodeDetectorDelayEveryCall(page, 800);

      await page.evaluate(() => {
        document.getElementById("google-qr").style.display = "none";
      });
      const staleScanPromise = invokeContentHarness(page);
      await page.waitForTimeout(150);

      await page.evaluate(() => {
        document.getElementById("google-qr").style.display = "";
      });
      const currentScanPromise = invokeContentHarness(page);

      await Promise.all([staleScanPromise, currentScanPromise]);
      await waitForMarkerCount(page, 1);
      assert.notEqual(await toastText(page), "No QR codes detected on the screen.");
      await page.close();
    });

    await runTest("prepare scan invalidates stale in-flight marker updates", async () => {
      const page = await openFixture(context, baseUrl, "single.html");
      await installContentHarness(page);
      await installBarcodeDetectorDelayEveryCall(page, 800);

      const staleScanPromise = invokeContentHarness(page);
      await page.waitForTimeout(150);
      await dispatchHarnessMessage(page, { type: "simple-qr-code-reader:prepare-scan" });

      await staleScanPromise;
      assert.equal(await markerCount(page), 0);
      assert.equal(await toastText(page), null);
      await page.close();
    });

    await runTest("same visible screenshot reuses cached QR detections", async () => {
      const page = await openFixture(context, baseUrl, "single.html");
      await installContentHarness(page);
      await installBarcodeDetectorCounter(page);

      await invokeContentHarness(page);
      await waitForMarkerCount(page, 1);
      const detectCallCountAfterFirstScan = await barcodeDetectorCallCount(page);
      assert.ok(detectCallCountAfterFirstScan > 0, "Expected the first scan to call BarcodeDetector.");

      await invokeContentHarness(page);
      await waitForMarkerCount(page, 1);
      assert.equal(
        await barcodeDetectorCallCount(page),
        detectCallCountAfterFirstScan,
        "Expected the second identical scan to reuse cached QR detections."
      );

      await page.close();
    });

    await runTest("two QR codes are marked and selected QR is copied", async () => {
      const page = await openFixture(context, baseUrl, "multiple.html");
      await writeClipboard(page, "before-multiple");

      await invokeExtensionScan(context, page);
      await waitForMarkerCount(page, 2);

      const markers = await readMarkers(page);
      assert.deepEqual(
        markers.map((marker) => marker.value).sort(),
        ["example.com", "google.com"]
      );

      const googleMarker = markers.find((marker) => marker.value === "google.com");
      assert.ok(googleMarker, "Expected the google.com QR code to have a marker.");
      await page.mouse.move(googleMarker.centerX, googleMarker.centerY);
      await page.mouse.down();
      await page.mouse.move(8, 8);
      await page.mouse.move(googleMarker.centerX, googleMarker.centerY);
      await page.mouse.up();
      await page.waitForTimeout(250);
      assert.equal(await readClipboard(page), "before-multiple");
      assert.equal(await markerCount(page), 2);

      const exampleMarker = markers.find((marker) => marker.value === "example.com");
      assert.ok(exampleMarker, "Expected the example.com QR code to have a marker.");
      await page.mouse.click(exampleMarker.centerX, exampleMarker.centerY);

      await waitForToast(page, "example.com is copied to clipboard");
      assert.equal(await readClipboard(page), "example.com");
      assert.equal(await markerCount(page), 0);
      await waitForToastToDisappear(page);
      await page.close();
    });

    await runTest("embedded QR marker outline stays on the QR code only", async () => {
      const page = await openFixture(context, baseUrl, "embedded-canvas.html");

      await installContentHarness(page);
      await invokeContentHarness(page);
      await waitForMarkerCount(page, 1);

      const marker = await readMarker(page, "google.com");
      const canvas = await readElementRect(page, "embedded-qr");
      const qrBounds = await readExpectedQrBounds(page, "embedded-qr");
      assert.ok(marker.outlineWidth < canvas.width / 2, "Expected marker outline to be narrower than the parent image.");
      assert.ok(marker.outlineHeight < canvas.height / 1.5, "Expected marker outline to be shorter than the parent image.");
      assert.ok(marker.outlineLeft >= canvas.left, "Expected marker outline to be inside the parent image.");
      assert.ok(marker.outlineTop >= canvas.top, "Expected marker outline to be inside the parent image.");
      assert.ok(marker.outlineRight <= canvas.left + canvas.width, "Expected marker outline to be inside the parent image.");
      assert.ok(marker.outlineBottom <= canvas.top + canvas.height, "Expected marker outline to be inside the parent image.");
      assertApproximatelyEqual(marker.outlineCenterX, qrBounds.centerX, 8, "Expected marker outline to be centered on the embedded QR code.");
      assertApproximatelyEqual(marker.outlineCenterY, qrBounds.centerY, 8, "Expected marker outline to be centered on the embedded QR code.");
      assertApproximatelyEqual(marker.outlineWidth, qrBounds.width, 14, "Expected marker outline width to match the embedded QR code.");
      assertApproximatelyEqual(marker.outlineHeight, qrBounds.height, 14, "Expected marker outline height to match the embedded QR code.");
      await page.close();
    });

    await runTest("QR marker outline does not bleed into nearby barcode content", async () => {
      const page = await openFixture(context, baseUrl, "qr-barcode-card.html");

      await installContentHarness(page);
      await invokeContentHarness(page);
      await waitForMarkerCount(page, 1);

      const marker = await readMarker(page, "google.com");
      const qrBounds = await readExpectedQrBounds(page, "qr-barcode-card");
      assertApproximatelyEqual(marker.outlineCenterX, qrBounds.centerX, 8, "Expected marker outline to be centered on the QR symbol.");
      assertApproximatelyEqual(marker.outlineCenterY, qrBounds.centerY, 8, "Expected marker outline to be centered on the QR symbol.");
      assertApproximatelyEqual(marker.outlineWidth, qrBounds.width, 10, "Expected marker outline width to match the QR symbol.");
      assertApproximatelyEqual(marker.outlineHeight, qrBounds.height, 10, "Expected marker outline height to match the QR symbol.");
      assert.ok(marker.outlineRight < qrBounds.left + qrBounds.width + 12, "Expected marker outline not to bleed into barcode content.");
      await page.close();
    });

    await runTest("QR marker outline matches a small QR thumbnail next to barcode content", async () => {
      const page = await openFixture(context, baseUrl, "barcode-qr-thumbnail.html");

      await installContentHarness(page);
      await invokeContentHarness(page);
      await waitForMarkerCount(page, 1);

      const marker = await readMarker(page, "google.com");
      const qrBounds = await readExpectedQrBounds(page, "barcode-qr-thumbnail");
      assertApproximatelyEqual(marker.outlineCenterX, qrBounds.centerX, 8, "Expected marker outline to be centered on the QR thumbnail.");
      assertApproximatelyEqual(marker.outlineCenterY, qrBounds.centerY, 8, "Expected marker outline to be centered on the QR thumbnail.");
      assertApproximatelyEqual(marker.outlineWidth, qrBounds.width, 10, "Expected marker outline width to match the QR thumbnail.");
      assertApproximatelyEqual(marker.outlineHeight, qrBounds.height, 10, "Expected marker outline height to match the QR thumbnail.");
      await page.close();
    });

    await runTest("QR marker outline matches the provided screenshot crop layout", async () => {
      const page = await openFixture(context, baseUrl, "screenshot-crop-qr-barcode.html");

      await installContentHarness(page);
      await invokeContentHarness(page);
      await waitForMarkerCount(page, 1);

      const marker = await readMarker(page, "google.com");
      const qrBounds = await readExpectedQrBounds(page, "screenshot-crop-qr-barcode");
      assertApproximatelyEqual(marker.outlineLeft, qrBounds.left, 8, "Expected marker outline left edge to match the screenshot QR crop.");
      assertApproximatelyEqual(marker.outlineTop, qrBounds.top, 8, "Expected marker outline top edge to match the screenshot QR crop.");
      assertApproximatelyEqual(marker.outlineWidth, qrBounds.width, 10, "Expected marker outline width to match the screenshot QR crop.");
      assertApproximatelyEqual(marker.outlineHeight, qrBounds.height, 10, "Expected marker outline height to match the screenshot QR crop.");
      await page.close();
    });

    await runTest("QR marker outlines match every expected QR in the screenshot grid", async () => {
      const page = await openFixtureWithViewport(context, baseUrl, "google-images-screenshot-grid.html", {
        width: 2048,
        height: 438
      });

      await installContentHarness(page);
      await invokeContentHarness(page);

      const expectedBounds = await readExpectedQrBoundsList(page);
      const markers = await readMarkers(page);
      assert.equal(markers.length, expectedBounds.length, `Expected ${expectedBounds.length} markers and found ${markers.length}.`);
      assertMarkersMatchExpectedBounds(markers, expectedBounds, 10);
      await page.close();
    });

    await runTest("QR markers follow page content when scrolling", async () => {
      const page = await openFixture(context, baseUrl, "multiple-scroll.html");

      await invokeExtensionScan(context, page);
      await waitForMarkerCount(page, 2);
      await waitForMarkerOutlineInsideQrVisual(page, "google.com", "google-qr");

      const beforeMarker = await readMarker(page, "google.com");
      const beforeVisual = await readQrVisual(page, "google-qr");
      await page.evaluate(() => window.scrollBy(0, 180));

      await page.waitForFunction(
        ({ previousCenterY, value }) => {
          const marker = markerByValue(value);
          if (!marker) {
            return false;
          }

          const rect = marker.getBoundingClientRect();
          const centerY = rect.top + rect.height / 2;
          return centerY < previousCenterY - 150;

          function markerByValue(markerValue) {
            const root = document.getElementById("simple-qr-code-reader-root");
            const markers = root?.shadowRoot?.querySelectorAll("[data-qr-marker]") || [];
            return Array.from(markers).find((candidate) => candidate.dataset.qrValue === markerValue);
          }
        },
        { previousCenterY: beforeMarker.centerY, value: "google.com" },
        { timeout: 3000 }
      );

      const afterMarker = await readMarker(page, "google.com");
      const afterVisual = await readQrVisual(page, "google-qr");
      assertApproximatelyEqual(
        afterMarker.outlineCenterY - beforeMarker.outlineCenterY,
        afterVisual.centerY - beforeVisual.centerY,
        4,
        "Expected marker and QR frame to move together while scrolling."
      );
      await waitForMarkerOutlineInsideQrVisual(page, "google.com", "google-qr");
      await page.close();
    });

    await runTest("QR marker follows sticky page content while scrolling", async () => {
      const page = await openFixture(context, baseUrl, "sticky-scroll.html");

      await installContentHarness(page);
      await invokeContentHarness(page);
      await waitForMarkerCount(page, 1);
      await waitForMarkerOutlineInsideQrVisual(page, "google.com", "sticky-qr");

      const beforeMarker = await readMarker(page, "google.com");
      const beforeVisual = await readQrVisual(page, "sticky-qr");
      await page.evaluate(() => window.scrollTo(0, 520));
      await waitForMarkerOutlineInsideQrVisual(page, "google.com", "sticky-qr");

      const afterMarker = await readMarker(page, "google.com");
      const afterVisual = await readQrVisual(page, "sticky-qr");
      assertApproximatelyEqual(
        afterVisual.centerY,
        beforeVisual.centerY,
        2,
        "Expected sticky QR visual to stay in place while the page scrolls."
      );
      assertApproximatelyEqual(
        afterMarker.outlineCenterY,
        afterVisual.centerY,
        4,
        "Expected marker outline to stay aligned to the sticky QR visual after scrolling."
      );
      await page.close();
    });

    await runTest("QR markers realign after browser resize without rescanning", async () => {
      const page = await openFixture(context, baseUrl, "multiple-scroll.html");

      await installContentHarness(page);
      await invokeContentHarness(page);
      await waitForMarkerCount(page, 2);
      await waitForMarkerOutlineInsideQrVisual(page, "google.com", "google-qr");
      assert.deepEqual(await markerValues(page), ["example.com", "google.com"]);

      await page.setViewportSize({ width: 960, height: 900 });

      await waitForMarkerCount(page, 2);
      assert.equal(await harnessRequestScanCount(page), 0);
      assert.deepEqual(await markerValues(page), ["example.com", "google.com"]);
      await waitForMarkerOutlineInsideQrVisual(page, "google.com", "google-qr");
      await waitForMarkerOutlineInsideQrVisual(page, "example.com", "example-qr");
      await page.close();
    });

    await runTest("QR markers match rendered QR size after page zoom", async () => {
      const page = await openFixture(context, baseUrl, "multiple-scroll.html");

      await installContentHarness(page);
      await invokeContentHarness(page);
      await waitForMarkerCount(page, 2);
      assert.deepEqual(await markerValues(page), ["example.com", "google.com"]);
      await page.evaluate(() => {
        document.body.style.zoom = "1.2";
        window.dispatchEvent(new Event("resize"));
      });

      await waitForMarkerCount(page, 2);
      assert.equal(await harnessRequestScanCount(page), 0);
      assert.deepEqual(await markerValues(page), ["example.com", "google.com"]);
      await waitForMarkerOutlineInsideQrVisual(page, "google.com", "google-qr");
      await waitForMarkerOutlineInsideQrVisual(page, "example.com", "example-qr");
      await page.close();
    });

    await runTest("zero QR codes leaves clipboard unchanged and shows message", async () => {
      const page = await openFixture(context, baseUrl, "empty.html");
      await writeClipboard(page, "unchanged");

      await invokeExtensionScan(context, page);

      await waitForToast(page, "No QR codes detected on the screen.");
      assert.equal(await readClipboard(page), "unchanged");
      assert.equal(await markerCount(page), 0);
      await waitForToastToDisappear(page);
      await page.close();
    });
  } finally {
    await context.close();
    await server.close();
    await rm(userDataDir, { force: true, recursive: true });
  }
}

async function testBrowserPath() {
  try {
    const bundledChromiumPath = chromium.executablePath();
    await access(bundledChromiumPath);
    return bundledChromiumPath;
  } catch (_error) {
    // Fall back to installed Chrome when Playwright's extension-capable browser is unavailable.
  }

  try {
    await access(defaultChromePath);
    return defaultChromePath;
  } catch (_error) {
    return chromium.executablePath();
  }
}

async function startFixtureServer() {
  const server = createServer(async (request, response) => {
    try {
      const requestedPath = new URL(request.url, "http://127.0.0.1").pathname;
      const fileName = requestedPath === "/" ? "single.html" : path.basename(requestedPath);
      const filePath = path.join(fixturesDir, fileName);
      const body = await readFile(filePath);

      response.writeHead(200, {
        "content-type": contentTypes.get(path.extname(filePath)) || "application/octet-stream"
      });
      response.end(body);
    } catch (error) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end(error.message);
    }
  });

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  return {
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function openFixture(context, baseUrl, fixtureName) {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/${fixtureName}`, { waitUntil: "load" });
  await page.bringToFront();
  await page.waitForFunction(() => document.readyState === "complete");
  return page;
}

async function openFixtureWithViewport(context, baseUrl, fixtureName, viewport) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(`${baseUrl}/${fixtureName}`, { waitUntil: "load" });
  await page.bringToFront();
  await page.waitForFunction(() => document.readyState === "complete");
  return page;
}

async function invokeExtensionScan(context, page) {
  await page.bringToFront();
  const worker = await extensionWorker(context);

  if (!worker) {
    if (requireExtensionWorker) {
      throw new Error("Extension service worker was not available.");
    }

    console.warn("WARN Extension service worker unavailable; using content harness fallback.");
    await invokeContentHarness(page);
    return;
  }

  try {
    await worker.evaluate(async () => {
      const MESSAGE = Object.freeze({
        ping: "simple-qr-code-reader:ping",
        prepareScan: "simple-qr-code-reader:prepare-scan",
        processScreenshot: "simple-qr-code-reader:process-screenshot"
      });
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const isReady = await chrome.tabs.sendMessage(tab.id, { type: MESSAGE.ping })
        .then((response) => Boolean(response && response.ok))
        .catch(() => false);

      if (!isReady) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["src/content.js"]
        });
      }

      await chrome.tabs.sendMessage(tab.id, { type: MESSAGE.prepareScan });
      const imageDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: "png"
      });
      await chrome.tabs.sendMessage(tab.id, {
        type: MESSAGE.processScreenshot,
        imageDataUrl
      });
    });
  } catch (error) {
    if (requireExtensionWorker) {
      throw error;
    }

    console.warn(`WARN Extension worker scan unavailable; using content harness fallback. ${error.message}`);
    await invokeContentHarness(page);
  }
}

async function extensionWorker(context) {
  const existingWorker = context.serviceWorkers().find((worker) => {
    return worker.url().startsWith("chrome-extension://") && worker.url().endsWith("/src/background.js");
  });

  let worker = existingWorker;
  if (!worker) {
    try {
      worker = await context.waitForEvent("serviceworker", {
        predicate: (candidate) => {
          return candidate.url().startsWith("chrome-extension://") &&
            candidate.url().endsWith("/src/background.js");
        },
        timeout: 2000
      });
    } catch (_error) {
      return null;
    }
  }

  return worker;
}

async function invokeContentHarness(page, options = {}) {
  await installContentHarness(page);
  await dispatchHarnessMessage(page, { type: "simple-qr-code-reader:prepare-scan" });

  const screenshot = await page.screenshot({ fullPage: false, type: "png" });
  const response = await dispatchHarnessMessage(page, {
    type: "simple-qr-code-reader:process-screenshot",
    imageDataUrl: `data:image/png;base64,${screenshot.toString("base64")}`
  });

  if (response && response.ok === false && !options.allowFailure) {
    throw new Error(response.error || "Content harness scan failed.");
  }

  return response;
}

async function installContentHarness(page) {
  const isInstalled = await page.evaluate(() => Boolean(window.__simpleQrCodeReaderHarnessInstalled));
  if (isInstalled) {
    return;
  }

  await page.evaluate((timeoutMs) => {
    const listeners = [];

    window.chrome = {
      runtime: {
        onMessage: {
          addListener(listener) {
            listeners.push(listener);
          }
        },
        sendMessage(message) {
          if (message && message.type === "simple-qr-code-reader:copy-text") {
            return navigator.clipboard
              .writeText(message.text)
              .then(() => ({ ok: true }))
              .catch((error) => ({ ok: false, error: error.message }));
          }

          if (message && message.type === "simple-qr-code-reader:request-scan") {
            window.__simpleQrCodeReaderHarnessRequestScanCount =
              (window.__simpleQrCodeReaderHarnessRequestScanCount || 0) + 1;
            return Promise.resolve({ ok: true });
          }

          return Promise.resolve({ ok: false, error: "Unexpected harness message." });
        }
      }
    };

    window.__simpleQrCodeReaderHarnessDispatch = (message) => {
      return new Promise((resolve, reject) => {
        let settled = false;
        const timer = window.setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new Error(`Harness message timed out: ${message.type}`));
          }
        }, timeoutMs);

        const sendResponse = (response) => {
          if (!settled) {
            settled = true;
            window.clearTimeout(timer);
            resolve(response);
          }
        };

        for (const listener of listeners) {
          try {
            const result = listener(message, {}, sendResponse);
            if (result === true) {
              return;
            }

            if (settled) {
              return;
            }

            if (result !== false && result !== undefined) {
              sendResponse(result);
              return;
            }
          } catch (error) {
            window.clearTimeout(timer);
            reject(error);
            return;
          }
        }

        sendResponse(undefined);
      });
    };

    window.__simpleQrCodeReaderHarnessInstalled = true;
    window.__simpleQrCodeReaderHarnessRequestScanCount = 0;
  }, harnessMessageTimeoutMs);

  await page.addScriptTag({ path: contentScriptPath });
}

async function installBarcodeDetectorCounter(page) {
  await page.evaluate(() => {
    if (window.__simpleQrCodeReaderBarcodeDetectorCounterInstalled) {
      return;
    }

    const NativeBarcodeDetector = window.BarcodeDetector;
    window.__simpleQrCodeReaderBarcodeDetectorCallCount = 0;
    window.BarcodeDetector = class CountingBarcodeDetector {
      static getSupportedFormats() {
        return NativeBarcodeDetector.getSupportedFormats
          ? NativeBarcodeDetector.getSupportedFormats()
          : Promise.resolve(["qr_code"]);
      }

      constructor(options) {
        this.detector = new NativeBarcodeDetector(options);
      }

      detect(source) {
        window.__simpleQrCodeReaderBarcodeDetectorCallCount += 1;
        return this.detector.detect(source);
      }
    };
    window.__simpleQrCodeReaderBarcodeDetectorCounterInstalled = true;
  });
}

async function installCanvasContextRecorder(page) {
  await page.evaluate(() => {
    if (window.__simpleQrCodeReaderCanvasContextRecorderInstalled) {
      return;
    }

    const nativeGetContext = HTMLCanvasElement.prototype.getContext;
    const seenCanvases = new WeakSet();
    const records = [];

    HTMLCanvasElement.prototype.getContext = function recordedGetContext(type, options) {
      if (type === "2d" && !seenCanvases.has(this)) {
        seenCanvases.add(this);
        records.push({
          canvasId: this.id || "",
          width: this.width,
          height: this.height,
          alpha: options && Object.prototype.hasOwnProperty.call(options, "alpha") ? options.alpha : null,
          willReadFrequently: Boolean(options && options.willReadFrequently)
        });
      }

      return nativeGetContext.apply(this, arguments);
    };

    window.__simpleQrCodeReaderCanvasContextRecords = records;
    window.__simpleQrCodeReaderCanvasContextRecorderInstalled = true;
  });
}

async function canvasContextRecords(page) {
  return page.evaluate(() => window.__simpleQrCodeReaderCanvasContextRecords || []);
}

async function installMissingBarcodeDetector(page) {
  await page.evaluate(() => {
    Object.defineProperty(window, "BarcodeDetector", {
      configurable: true,
      value: undefined
    });
  });
}

async function installUnsupportedBarcodeDetectorFormats(page) {
  await page.evaluate(() => {
    window.BarcodeDetector = class UnsupportedBarcodeDetector {
      static getSupportedFormats() {
        return Promise.resolve(["aztec", "code_128"]);
      }

      detect() {
        throw new Error("BarcodeDetector.detect should not be called when qr_code is unsupported.");
      }
    };
  });
}

async function installCopyFailure(page, message) {
  await page.evaluate((errorMessage) => {
    const nativeSendMessage = window.chrome.runtime.sendMessage;
    window.chrome.runtime.sendMessage = (payload) => {
      if (payload && payload.type === "simple-qr-code-reader:copy-text") {
        return Promise.resolve({ ok: false, error: errorMessage });
      }

      return nativeSendMessage(payload);
    };
  }, message);
}

async function barcodeDetectorCallCount(page) {
  return page.evaluate(() => window.__simpleQrCodeReaderBarcodeDetectorCallCount || 0);
}

async function installBarcodeDetectorDelayAfterFirstSuccess(page, delayMs) {
  await page.evaluate((delay) => {
    if (window.__simpleQrCodeReaderBarcodeDetectorDelayInstalled) {
      return;
    }

    const NativeBarcodeDetector = window.BarcodeDetector;
    window.BarcodeDetector = class DelayedBarcodeDetector {
      static getSupportedFormats() {
        return NativeBarcodeDetector.getSupportedFormats
          ? NativeBarcodeDetector.getSupportedFormats()
          : Promise.resolve(["qr_code"]);
      }

      constructor(options) {
        this.detector = new NativeBarcodeDetector(options);
      }

      async detect(source) {
        const results = await this.detector.detect(source);
        if (!window.__simpleQrCodeReaderFirstSuccessfulDetectionSeen && results.length > 0) {
          window.__simpleQrCodeReaderFirstSuccessfulDetectionSeen = true;
          return results;
        }

        if (window.__simpleQrCodeReaderFirstSuccessfulDetectionSeen) {
          await new Promise((resolve) => window.setTimeout(resolve, delay));
        }

        return results;
      }
    };
    window.__simpleQrCodeReaderBarcodeDetectorDelayInstalled = true;
  }, delayMs);
}

async function installBarcodeDetectorDelayEveryCall(page, delayMs) {
  await page.evaluate((delay) => {
    if (window.__simpleQrCodeReaderBarcodeDetectorDelayEveryCallInstalled) {
      return;
    }

    const NativeBarcodeDetector = window.BarcodeDetector;
    window.BarcodeDetector = class DelayedBarcodeDetector {
      static getSupportedFormats() {
        return NativeBarcodeDetector.getSupportedFormats
          ? NativeBarcodeDetector.getSupportedFormats()
          : Promise.resolve(["qr_code"]);
      }

      constructor(options) {
        this.detector = new NativeBarcodeDetector(options);
      }

      async detect(source) {
        const results = await this.detector.detect(source);
        await new Promise((resolve) => window.setTimeout(resolve, delay));
        return results;
      }
    };
    window.__simpleQrCodeReaderBarcodeDetectorDelayEveryCallInstalled = true;
  }, delayMs);
}

async function dispatchHarnessMessage(page, message) {
  return page.evaluate((payload) => window.__simpleQrCodeReaderHarnessDispatch(payload), message);
}

async function writeClipboard(page, text) {
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
}

async function readClipboard(page) {
  return page.evaluate(() => navigator.clipboard.readText());
}

async function waitForToast(page, expectedText) {
  await page.waitForFunction(
    (text) => {
      const root = document.getElementById("simple-qr-code-reader-root");
      const toast = root?.shadowRoot?.querySelector("[data-qr-toast]");
      return (toast?.textContent || null) === text;
    },
    expectedText,
    { timeout: 5000 }
  );
}

async function waitForToastToDisappear(page) {
  await page.waitForFunction(
    () => {
      const root = document.getElementById("simple-qr-code-reader-root");
      const toast = root?.shadowRoot?.querySelector("[data-qr-toast]");
      return !toast;
    },
    undefined,
    { timeout: toastDurationMs + 1500 }
  );
}

async function toastText(page) {
  return page.evaluate(() => {
    const root = document.getElementById("simple-qr-code-reader-root");
    const toast = root?.shadowRoot?.querySelector("[data-qr-toast]");
    return toast?.textContent || null;
  });
}

async function waitForMarkerCount(page, expectedCount) {
  await page.waitForFunction(
    (count) => {
      const root = document.getElementById("simple-qr-code-reader-root");
      const markers = root?.shadowRoot?.querySelectorAll("[data-qr-marker]");
      return (markers?.length || 0) === count;
    },
    expectedCount,
    { timeout: 5000 }
  );
}

async function markerCount(page) {
  return page.evaluate(() => {
    const root = document.getElementById("simple-qr-code-reader-root");
    const markers = root?.shadowRoot?.querySelectorAll("[data-qr-marker]");
    return markers?.length || 0;
  });
}

async function readMarkers(page) {
  return page.evaluate(() => {
    const root = document.getElementById("simple-qr-code-reader-root");
    const markerElements = root?.shadowRoot?.querySelectorAll("[data-qr-marker]") || [];
    return Array.from(markerElements).map((marker) => {
      const rect = marker.getBoundingClientRect();
      const style = getComputedStyle(marker);
      const outlineLeftOffset = Number.parseFloat(style.getPropertyValue("--qr-outline-left")) || 0;
      const outlineTopOffset = Number.parseFloat(style.getPropertyValue("--qr-outline-top")) || 0;
      const outlineWidth = Number.parseFloat(style.getPropertyValue("--qr-outline-width")) || rect.width;
      const outlineHeight = Number.parseFloat(style.getPropertyValue("--qr-outline-height")) || rect.height;
      const outlineLeft = rect.left + outlineLeftOffset;
      const outlineTop = rect.top + outlineTopOffset;

      return {
        value: marker.dataset.qrValue,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
        outlineLeft,
        outlineTop,
        outlineWidth,
        outlineHeight,
        outlineRight: outlineLeft + outlineWidth,
        outlineBottom: outlineTop + outlineHeight,
        outlineCenterX: outlineLeft + outlineWidth / 2,
        outlineCenterY: outlineTop + outlineHeight / 2
      };
    });
  });
}

async function markerValues(page) {
  const markers = await readMarkers(page);
  return markers.map((marker) => marker.value).sort();
}

async function readMarker(page, value) {
  const markers = await readMarkers(page);
  const marker = markers.find((candidate) => candidate.value === value);
  assert.ok(marker, `Expected marker for ${value}.`);
  return marker;
}

async function focusMarker(page, value) {
  await page.evaluate((markerValue) => {
    const root = document.getElementById("simple-qr-code-reader-root");
    const markers = root?.shadowRoot?.querySelectorAll("[data-qr-marker]") || [];
    const marker = Array.from(markers).find((candidate) => candidate.dataset.qrValue === markerValue);
    if (!marker) {
      throw new Error(`Expected marker for ${markerValue}.`);
    }

    marker.focus();
  }, value);
}

async function readQrVisual(page, frameId) {
  const visual = await page.evaluate((id) => {
    const element = document.getElementById(id)?.querySelector("svg,img,canvas");
    const rect = element?.getBoundingClientRect();
    if (!rect) {
      return null;
    }

    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2
    };
  }, frameId);
  assert.ok(visual, `Expected QR visual in ${frameId}.`);
  return visual;
}

async function readElementRect(page, elementId) {
  const rect = await page.evaluate((id) => {
    const element = document.getElementById(id);
    const bounds = element?.getBoundingClientRect();
    if (!bounds) {
      return null;
    }

    return {
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
      centerX: bounds.left + bounds.width / 2,
      centerY: bounds.top + bounds.height / 2
    };
  }, elementId);
  assert.ok(rect, `Expected element ${elementId}.`);
  return rect;
}

async function readExpectedQrBounds(page, elementId) {
  const bounds = await page.evaluate((id) => {
    const element = document.getElementById(id);
    const rect = element?.getBoundingClientRect();
    if (!element || !rect) {
      return null;
    }

    const left = Number(element.dataset.qrLeft);
    const top = Number(element.dataset.qrTop);
    const size = Number(element.dataset.qrSize);
    const scaleX = rect.width / element.width;
    const scaleY = rect.height / element.height;
    const scaledLeft = rect.left + left * scaleX;
    const scaledTop = rect.top + top * scaleY;
    const scaledWidth = size * scaleX;
    const scaledHeight = size * scaleY;

    return {
      left: scaledLeft,
      top: scaledTop,
      width: scaledWidth,
      height: scaledHeight,
      centerX: scaledLeft + scaledWidth / 2,
      centerY: scaledTop + scaledHeight / 2
    };
  }, elementId);
  assert.ok(bounds, `Expected QR bounds for ${elementId}.`);
  return bounds;
}

async function readExpectedQrBoundsList(page) {
  const bounds = await page.evaluate(() => window.expectedQrBounds || []);
  assert.ok(Array.isArray(bounds), "Expected QR bounds list.");
  assert.ok(bounds.length > 0, "Expected at least one QR bound.");
  return bounds;
}

function assertMarkersMatchExpectedBounds(markers, expectedBounds, tolerance) {
  assert.equal(
    markers.length,
    expectedBounds.length,
    `Expected ${expectedBounds.length} QR markers, got ${markers.length}.`
  );

  const unmatchedMarkers = [...markers];
  for (const expected of expectedBounds) {
    let bestIndex = -1;
    let bestDistance = Infinity;

    unmatchedMarkers.forEach((marker, index) => {
      const distance = Math.hypot(marker.outlineCenterX - expected.left - expected.width / 2, marker.outlineCenterY - expected.top - expected.height / 2);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });

    assert.notEqual(bestIndex, -1, `Expected marker for ${expected.id}.`);
    const marker = unmatchedMarkers.splice(bestIndex, 1)[0];
    assertApproximatelyEqual(marker.outlineLeft, expected.left, tolerance, `Expected ${expected.id} marker left edge to match.`);
    assertApproximatelyEqual(marker.outlineTop, expected.top, tolerance, `Expected ${expected.id} marker top edge to match.`);
    assertApproximatelyEqual(marker.outlineWidth, expected.width, tolerance, `Expected ${expected.id} marker width to match.`);
    assertApproximatelyEqual(marker.outlineHeight, expected.height, tolerance, `Expected ${expected.id} marker height to match.`);
  }
}

async function harnessRequestScanCount(page) {
  return page.evaluate(() => window.__simpleQrCodeReaderHarnessRequestScanCount || 0);
}

async function waitForMarkerOutlineInsideQrVisual(page, value, frameId) {
  await page.waitForFunction(
    ({ markerValue, qrFrameId }) => {
      const root = document.getElementById("simple-qr-code-reader-root");
      const markers = root?.shadowRoot?.querySelectorAll("[data-qr-marker]") || [];
      const marker = Array.from(markers).find((candidate) => candidate.dataset.qrValue === markerValue);
      const visual = document.getElementById(qrFrameId)?.querySelector("svg,img,canvas");

      if (!marker || !visual) {
        return false;
      }

      const markerRect = marker.getBoundingClientRect();
      const markerStyle = getComputedStyle(marker);
      const outlineLeft = markerRect.left + (Number.parseFloat(markerStyle.getPropertyValue("--qr-outline-left")) || 0);
      const outlineTop = markerRect.top + (Number.parseFloat(markerStyle.getPropertyValue("--qr-outline-top")) || 0);
      const outlineWidth = Number.parseFloat(markerStyle.getPropertyValue("--qr-outline-width")) || markerRect.width;
      const outlineHeight = Number.parseFloat(markerStyle.getPropertyValue("--qr-outline-height")) || markerRect.height;
      const outlineCenterX = outlineLeft + outlineWidth / 2;
      const outlineCenterY = outlineTop + outlineHeight / 2;
      const visualRect = visual.getBoundingClientRect();
      const visualCenterX = visualRect.left + visualRect.width / 2;
      const visualCenterY = visualRect.top + visualRect.height / 2;
      const tolerance = 8;

      return outlineLeft >= visualRect.left - tolerance &&
        outlineTop >= visualRect.top - tolerance &&
        outlineLeft + outlineWidth <= visualRect.right + tolerance &&
        outlineTop + outlineHeight <= visualRect.bottom + tolerance &&
        Math.abs(outlineCenterX - visualCenterX) <= tolerance &&
        Math.abs(outlineCenterY - visualCenterY) <= tolerance;
    },
    { markerValue: value, qrFrameId: frameId },
    { timeout: 5000 }
  );
}

function assertApproximatelyEqual(actual, expected, tolerance, message) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message} Expected ${actual} to be within ${tolerance} of ${expected}.`
  );
}

async function runTest(name, testBody) {
  try {
    await testBody();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

await main();
