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
const contentScriptPath = path.join(extensionDir, "src", "content.js");
const fixturesDir = path.join(projectRoot, "tests", "fixtures");
const defaultChromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const toastDurationMs = 2000;
const requireExtensionWorker = process.env.REQUIRE_EXTENSION_WORKER === "1";

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"]
]);

async function main() {
  const chromePath = process.env.CHROME_PATH || await existingChromePath();
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

    await runTest("single QR copies google.com automatically", async () => {
      const page = await openFixture(context, baseUrl, "single.html");
      await writeClipboard(page, "before-single");

      await invokeExtensionScan(context, page);

      await waitForToast(page, "google.com is copied to clipboard");
      assert.equal(await readClipboard(page), "google.com");
      await waitForToastToDisappear(page);
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

async function existingChromePath() {
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

async function invokeContentHarness(page) {
  await installContentHarness(page);
  await dispatchHarnessMessage(page, { type: "simple-qr-code-reader:prepare-scan" });

  const screenshot = await page.screenshot({ fullPage: false, type: "png" });
  const response = await dispatchHarnessMessage(page, {
    type: "simple-qr-code-reader:process-screenshot",
    imageDataUrl: `data:image/png;base64,${screenshot.toString("base64")}`
  });

  if (response && response.ok === false) {
    throw new Error(response.error || "Content harness scan failed.");
  }
}

async function installContentHarness(page) {
  const isInstalled = await page.evaluate(() => Boolean(window.__simpleQrCodeReaderHarnessInstalled));
  if (isInstalled) {
    return;
  }

  await page.evaluate(() => {
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
        }, 5000);

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
  });

  await page.addScriptTag({ path: contentScriptPath });
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
      return {
        value: marker.dataset.qrValue,
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2
      };
    });
  });
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
