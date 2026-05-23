# Simple QR Code Reader

Simple QR Code Reader is a Manifest V3 Chrome extension that scans the visible area of the active tab for QR codes and copies the decoded value to the clipboard.

The extension is designed for the common case where a QR code appears on a web page and you want the underlying URL without using a phone camera.

## What It Does

- Scans only when you invoke the extension from the toolbar action or the `Alt+Shift+Q` shortcut.
- Copies the decoded QR value to the clipboard when exactly one visible QR code is detected.
- Marks each detected QR code when more than one is visible, then copies the one you select.
- Shows one shared toast UI for copy success and no-code messages.
- Automatically removes messages after 2 seconds.
- Processes screenshots locally in the browser. It does not send screenshots, QR values, clipboard contents, or browsing data to a server.

## How It Works

Chrome's `activeTab` permission lets the extension capture the visible area of the current tab only after you invoke it. The background service worker sends that screenshot to an offscreen document for QR decoding. The content script handles page overlays, QR selection markers, and toast messages.

The extension requests these permissions:

- `activeTab`: capture the current visible tab after explicit user invocation.
- `scripting`: inject the content script that displays markers and messages.
- `clipboardWrite`: copy the decoded QR value to the clipboard.
- `offscreen`: run Manifest V3-compatible QR decoding and clipboard work in a hidden document.

## Requirements

- Node.js 20 or newer.
- npm for installing development dependencies in a normal standalone setup.
- Google Chrome for the end-to-end test harness.
- `zip` for packaging the Chrome Web Store upload ZIP.
- `ffmpeg` only if rendering the optional marketing video.

Install dependencies:

```sh
npm install
```

If `npm` is unavailable but you already have a compatible Node runtime and dependencies, point the wrapper scripts at that runtime:

```sh
export NODE_BIN="/absolute/path/to/node"
export NODE_PATH="/absolute/path/to/node_modules"
```

## Development

Load the extension locally from Chrome:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Select Load unpacked.
4. Choose the `extension/` directory.

Run syntax checks:

```sh
npm run check
```

Run the end-to-end test suite:

```sh
npm test
```

The automated tests serve three local fixture pages:

- `tests/fixtures/single.html`: one QR code containing `google.com`.
- `tests/fixtures/multiple.html`: two visible QR codes containing `google.com` and `example.com`.
- `tests/fixtures/empty.html`: no QR codes.

The test harness launches Chrome with the unpacked extension and uses the extension service worker when Chrome exposes it to Playwright. If the service worker is unavailable, the harness prints a warning and injects the content script into fixture pages so QR detection, marker, clipboard, and toast behavior are still validated. Use `REQUIRE_EXTENSION_WORKER=1 npm test` when the run should fail unless the service worker path is available.

Codex desktop fallback:

```sh
node --check extension/src/background.js \
  && node --check extension/src/content.js \
  && node --check extension/src/offscreen.js \
  && node --check tests/run-tests.mjs \
  && node --check scripts/build-store-package.mjs \
  && node --check marketing-video/render-marketing-video.mjs

NODE_BIN="$NODE_BIN" NODE_PATH="$NODE_PATH" bash run-tests.sh
```

## Packaging

Build the Chrome Web Store upload ZIP:

```sh
npm run build
```

Codex desktop fallback:

```sh
NODE_BIN="$NODE_BIN" NODE_PATH="$NODE_PATH" bash build-store-package.sh
```

The build writes:

- `release/simple-qr-code-reader-1.0.zip`
- `release/simple-qr-code-reader-1.0.sha256`

The package script includes only extension files from `extension/`, strips extra ZIP metadata, normalizes timestamps, and writes a SHA-256 checksum.

## Optional Marketing Video

Render the short marketing video:

```sh
npm run render:video
```

Codex desktop fallback:

```sh
NODE_BIN="$NODE_BIN" NODE_PATH="$NODE_PATH" bash render-marketing-video.sh
```

The rendered MP4 is written to `marketing-video/renders/simple-qr-code-reader-promo-1.0.mp4`.

## Project Structure

- `extension/`: Chrome extension source, manifest, icons, and offscreen document.
- `extension/src/background.js`: invocation, screenshot capture, QR decoding coordination, and clipboard flow.
- `extension/src/content.js`: page overlays, QR markers, and toast UI.
- `extension/src/offscreen.js`: local QR decoding and clipboard write support.
- `tests/`: fixture pages and Playwright-based end-to-end validation.
- `scripts/`: release packaging script.
- `marketing-video/`: optional HyperFrames marketing video source.
- `PRIVACY.md`: privacy policy for the extension.

## Generated Artifacts

`release/`, `store-assets/`, and `marketing-video/renders/` are ignored local outputs. They are generated or maintained for packaging and store submission work and are not required for the extension source to function.
