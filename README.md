# Simple QR Code Reader

A Manifest V3 Chrome extension that scans the visible area of the active tab for QR codes and copies the decoded URL text to the clipboard.

## Requirements

- Node.js 20 or newer.
- npm for installing development dependencies in a normal standalone setup.
- Google Chrome for the end-to-end test harness.
- `zip` for packaging.
- `ffmpeg` only if rendering the marketing video.

For a normal standalone setup, install dependencies with:

```sh
npm install
```

If `npm` is unavailable but you already have a compatible Node runtime and dependencies, point the wrapper scripts at that runtime:

```sh
export NODE_BIN="/absolute/path/to/node"
export NODE_PATH="/absolute/path/to/node_modules"
```

## Behavior

- Invoke the extension from the toolbar action or the `Alt+Shift+Q` command.
- If one QR code is visible, its decoded value is copied immediately.
- If more than one QR code is visible, each detected code is marked on the page. Select one marker to copy that code and clear the markers.
- If no QR codes are visible, a shared toast says `No QR codes detected on the screen.`
- Copy and no-code messages use the same toast UI and disappear after 2 seconds.

## Test Fixtures

The automated tests serve these local pages:

- `tests/fixtures/single.html`: one QR code containing `google.com`.
- `tests/fixtures/multiple.html`: two visible QR codes containing `google.com` and `example.com`.
- `tests/fixtures/empty.html`: no QR codes.

Run the tests with:

```sh
npm run check
npm test
```

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

The test harness launches Chrome with this unpacked extension and uses the extension service worker when Chrome exposes it to Playwright. If the service worker is unavailable, the harness prints a warning and injects the content script into fixture pages so QR detection, marker, clipboard, and toast behavior are still validated. Use `REQUIRE_EXTENSION_WORKER=1 npm test` when you specifically need the run to fail unless the service worker path is available.

## Chrome Web Store Package

Build the upload ZIP and listing images with:

```sh
npm run build
```

Codex desktop fallback:

```sh
NODE_BIN="$NODE_BIN" NODE_PATH="$NODE_PATH" bash build-store-package.sh
```

Upload `release/simple-qr-code-reader-1.0.zip` in the Chrome Web Store Developer Dashboard. Store listing copy, permission justifications, test instructions, and the privacy-policy draft are in `PUBLISHING.md` and `PRIVACY.md`.

Render the short marketing video with:

```sh
npm run render:video
```

Codex desktop fallback:

```sh
NODE_BIN="$NODE_BIN" NODE_PATH="$NODE_PATH" bash render-marketing-video.sh
```

The rendered MP4 is written to `marketing-video/renders/simple-qr-code-reader-promo-1.0.mp4`.

## Generated Artifacts

`release/`, `store-assets/`, and `marketing-video/renders/` are generated outputs. They are ignored by git and can be regenerated with the commands above. Store listing assets are written to:

- `store-assets/store-icon-128x128.png`
- `store-assets/small-promo-440x280.png`
- `store-assets/marquee-promo-1400x560.png`
- `store-assets/screenshot-multi-select-1280x800.png`
