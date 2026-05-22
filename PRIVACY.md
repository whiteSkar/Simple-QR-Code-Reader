# Privacy Policy Draft

Effective date: [replace with publication date]

Simple QR Code Reader scans QR codes in the visible area of the active Chrome tab when you invoke the extension.

## Data Collection

The extension does not collect, sell, transmit, or store personal data.

When you invoke the extension, Chrome captures the visible area of the current tab so the extension can scan it locally for QR codes. That screenshot is processed only inside your browser and is not sent to any server.

If a QR code is detected and selected, the decoded text is copied to your clipboard. The extension does not store clipboard contents or send them anywhere.

## Permissions

The extension uses `activeTab` to access the current tab only after you invoke the extension. It uses `scripting` to show selection markers and messages on the current page. It uses `clipboardWrite` and `offscreen` to copy the selected decoded QR value to your clipboard from a Manifest V3-compatible hidden document.

## Data Sharing

No user data is shared with the developer, third parties, advertisers, analytics providers, or external services.

## Data Retention

The extension does not retain screenshots, decoded QR values, browsing history, or clipboard contents.

## Contact

Contact: [replace with support email or support URL]
