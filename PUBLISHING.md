# Chrome Web Store Publishing Notes

## Package

Upload this ZIP in the Chrome Web Store Developer Dashboard:

```text
release/simple-qr-code-reader-1.0.zip
```

The ZIP is generated with `manifest.json` at the root and excludes tests, release files, and local metadata.

Rebuild it with:

```sh
npm run build
```

## Store Listing Draft

Short description:

```text
Scan visible QR codes, choose one when several are present, and copy the decoded URL to your clipboard.
```

Detailed description:

```text
Simple QR Code Reader scans the visible area of the current tab for QR codes.

Use the toolbar icon or Alt+Shift+Q. If one QR code is visible, the decoded value is copied immediately. If more than one QR code is visible, the extension marks each detected QR code so you can choose which one to copy. If no QR code is visible, it shows a short message and leaves your clipboard unchanged.

The extension runs locally in Chrome. It does not send screenshots, QR contents, browsing history, or clipboard data to any server.
```

Category:

```text
Productivity
```

Language:

```text
English
```

## Graphic Assets

Generated assets:

- `store-assets/small-promo-440x280.png`
- `store-assets/screenshot-multi-select-1280x800.png`
- `marketing-video/renders/simple-qr-code-reader-promo-1.0.mp4`

The extension icon used by Chrome and the Web Store is bundled inside the extension ZIP at `icons/icon128.png`.

## Privacy Tab

Single purpose:

```text
Scan QR codes in the visible area of the active tab and copy the selected decoded value to the clipboard.
```

Remote code:

```text
No, this extension does not use remote code. All JavaScript, HTML, CSS, and images are bundled in the extension package.
```

Data use:

```text
This extension does not collect, sell, transfer, or store user data. Screenshots of the active tab are processed locally in Chrome only after the user invokes the extension, and decoded QR values are written only to the user's clipboard.
```

Recommended data disclosure selections:

```text
Do not select data collection categories unless the dashboard requires a category for local-only active-tab content processing. The extension does not transmit or retain any user data.
```

## Permission Justifications

`activeTab`

```text
Required to capture the visible area of the current tab only after the user invokes the extension with the toolbar action or keyboard command.
```

`scripting`

```text
Required to inject the scanner UI into the active tab after user invocation so detected QR codes can be marked and selected.
```

`clipboardWrite`

```text
Required to copy the selected decoded QR value to the user's clipboard.
```

`offscreen`

```text
Required because Manifest V3 service workers do not have DOM access; the extension uses a hidden offscreen document only to perform the clipboard write.
```

## Test Instructions For Reviewers

```text
1. Open a page with one visible QR code and click the extension icon. The decoded QR value is copied to the clipboard and a 2-second confirmation message appears.
2. Open a page with two visible QR codes and click the extension icon. Each QR code is marked. Click one marker. The selected decoded value is copied, markers disappear, and a 2-second confirmation message appears.
3. Open a page with no visible QR codes and click the extension icon. The clipboard is unchanged and a 2-second "No QR codes detected on the screen." message appears.
```

Local test pages are included outside the store package in `tests/fixtures`.

## Pre-submit Checklist

- Run `npm run check`.
- Run `npm test`.
- Run `npm run build`.
- Upload `release/simple-qr-code-reader-1.0.zip`.
- Upload `store-assets/small-promo-440x280.png`.
- Upload `store-assets/screenshot-multi-select-1280x800.png`.
- Use `marketing-video/renders/simple-qr-code-reader-promo-1.0.mp4` as the short marketing video asset wherever you host launch or support media.
- Add a public privacy policy URL. A draft is in `PRIVACY.md`; publish it on a website you control before submitting.
