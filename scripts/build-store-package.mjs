import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const extensionDir = path.join(projectRoot, "extension");
const iconDir = path.join(extensionDir, "icons");
const storeAssetsDir = path.join(projectRoot, "store-assets");
const releaseDir = path.join(projectRoot, "release");
const manifest = JSON.parse(await readFile(path.join(extensionDir, "manifest.json"), "utf8"));
const packageBaseName = `simple-qr-code-reader-${manifest.version}`;
const packagePath = path.join(releaseDir, `${packageBaseName}.zip`);
const checksumPath = path.join(releaseDir, `${packageBaseName}.sha256`);

await mkdir(iconDir, { recursive: true });
await mkdir(storeAssetsDir, { recursive: true });
await rm(releaseDir, { force: true, recursive: true });
await mkdir(releaseDir, { recursive: true });

await generateExtensionIcons();
await generateStoreAssets();
await packageExtension();
await writeChecksum();

console.log(`Created ${path.relative(process.cwd(), packagePath)}`);
console.log(`Created ${path.relative(process.cwd(), checksumPath)}`);
console.log(`Created store assets in ${path.relative(process.cwd(), storeAssetsDir)}`);

async function generateExtensionIcons() {
  for (const size of [16, 32, 48, 128]) {
    await sharp(Buffer.from(iconSvg(size)))
      .png()
      .toFile(path.join(iconDir, `icon${size}.png`));
  }
}

async function generateStoreAssets() {
  await sharp(Buffer.from(promoSvg()))
    .png()
    .toFile(path.join(storeAssetsDir, "small-promo-440x280.png"));

  await sharp(Buffer.from(screenshotSvg()))
    .png()
    .toFile(path.join(storeAssetsDir, "screenshot-multi-select-1280x800.png"));
}

async function packageExtension() {
  await rm(packagePath, { force: true });
  await execFileAsync(
    "zip",
    [
      "-qr",
      packagePath,
      ".",
      "-x",
      "*.DS_Store",
      "-x",
      "__MACOSX/*"
    ],
    { cwd: extensionDir }
  );
}

async function writeChecksum() {
  const bytes = await readFile(packagePath);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  await writeFile(checksumPath, `${checksum}  ${path.basename(packagePath)}\n`);
}

function iconSvg(size) {
  const scale = size / 128;
  const qrCell = (x, y, width = 1, height = 1) => {
    const cell = 6;
    return `<rect x="${32 + x * cell}" y="${32 + y * cell}" width="${width * cell}" height="${height * cell}" rx="${1.2 * scale}" fill="#202124"/>`;
  };

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="24" fill="#1a73e8"/>
  <rect x="16" y="16" width="96" height="96" rx="16" fill="#fff"/>
  <path d="M82 78h16v-9h10v26H98v-9H82z" fill="#34a853"/>
  <path d="M93 61l18 17-18 17v-12H70V73h23z" fill="#34a853"/>
  <rect x="28" y="28" width="22" height="22" rx="3" fill="#202124"/>
  <rect x="34" y="34" width="10" height="10" rx="2" fill="#fff"/>
  <rect x="78" y="28" width="22" height="22" rx="3" fill="#202124"/>
  <rect x="84" y="34" width="10" height="10" rx="2" fill="#fff"/>
  <rect x="28" y="78" width="22" height="22" rx="3" fill="#202124"/>
  <rect x="34" y="84" width="10" height="10" rx="2" fill="#fff"/>
  ${qrCell(5, 0)}
  ${qrCell(6, 0)}
  ${qrCell(0, 5)}
  ${qrCell(2, 5)}
  ${qrCell(4, 5)}
  ${qrCell(6, 5)}
  ${qrCell(5, 6)}
  ${qrCell(7, 6)}
  ${qrCell(0, 7)}
  ${qrCell(1, 7)}
  ${qrCell(4, 7)}
  ${qrCell(6, 7)}
  ${qrCell(7, 7)}
</svg>`;
}

function promoSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="440" height="280" viewBox="0 0 440 280">
  <rect width="440" height="280" fill="#f8fafd"/>
  <rect x="28" y="30" width="384" height="220" rx="18" fill="#fff" stroke="#dfe5f2"/>
  <rect x="58" y="60" width="128" height="128" rx="16" fill="#1a73e8"/>
  <rect x="74" y="76" width="96" height="96" rx="14" fill="#fff"/>
  <rect x="86" y="88" width="24" height="24" rx="3" fill="#202124"/>
  <rect x="134" y="88" width="24" height="24" rx="3" fill="#202124"/>
  <rect x="86" y="136" width="24" height="24" rx="3" fill="#202124"/>
  <rect x="122" y="122" width="12" height="12" fill="#202124"/>
  <rect x="140" y="128" width="12" height="12" fill="#202124"/>
  <rect x="122" y="146" width="30" height="12" fill="#202124"/>
  <path d="M182 154h42v-18l42 36-42 36v-18h-42z" fill="#34a853"/>
  <text x="232" y="96" fill="#202124" font-family="Arial, sans-serif" font-size="27" font-weight="700">Simple QR</text>
  <text x="232" y="129" fill="#202124" font-family="Arial, sans-serif" font-size="27" font-weight="700">Code Reader</text>
  <text x="232" y="166" fill="#5f6368" font-family="Arial, sans-serif" font-size="15">Scan visible QR codes</text>
  <text x="232" y="190" fill="#5f6368" font-family="Arial, sans-serif" font-size="15">and copy the URL.</text>
</svg>`;
}

function screenshotSvg() {
  const qrBlock = (x, y) => `
    <rect x="${x}" y="${y}" width="220" height="220" fill="#fff" stroke="#dadce0"/>
    <rect x="${x + 20}" y="${y + 20}" width="52" height="52" fill="#202124"/>
    <rect x="${x + 148}" y="${y + 20}" width="52" height="52" fill="#202124"/>
    <rect x="${x + 20}" y="${y + 148}" width="52" height="52" fill="#202124"/>
    <rect x="${x + 94}" y="${y + 88}" width="28" height="28" fill="#202124"/>
    <rect x="${x + 136}" y="${y + 94}" width="28" height="28" fill="#202124"/>
    <rect x="${x + 88}" y="${y + 136}" width="82" height="28" fill="#202124"/>
    <rect x="${x + 136}" y="${y + 172}" width="52" height="28" fill="#202124"/>
  `;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">
  <rect width="1280" height="800" fill="#f8f9fa"/>
  <text x="640" y="100" text-anchor="middle" fill="#202124" font-family="Arial, sans-serif" font-size="42" font-weight="700">Choose the QR code to copy</text>
  <text x="640" y="145" text-anchor="middle" fill="#5f6368" font-family="Arial, sans-serif" font-size="22">When more than one QR code is visible, the extension marks each code.</text>
  <g>
    <text x="400" y="250" text-anchor="middle" fill="#202124" font-family="Arial, sans-serif" font-size="28" font-weight="700">google.com</text>
    ${qrBlock(290, 290)}
    <rect x="282" y="282" width="236" height="236" rx="12" fill="rgba(26,115,232,0.14)" stroke="#1a73e8" stroke-width="8"/>
    <rect x="360" y="388" width="80" height="36" rx="18" fill="#1a73e8"/>
    <text x="400" y="412" text-anchor="middle" fill="#fff" font-family="Arial, sans-serif" font-size="18" font-weight="700">QR 1</text>
  </g>
  <g>
    <text x="880" y="250" text-anchor="middle" fill="#202124" font-family="Arial, sans-serif" font-size="28" font-weight="700">example.com</text>
    ${qrBlock(770, 290)}
    <rect x="762" y="282" width="236" height="236" rx="12" fill="rgba(26,115,232,0.14)" stroke="#1a73e8" stroke-width="8"/>
    <rect x="840" y="388" width="80" height="36" rx="18" fill="#1a73e8"/>
    <text x="880" y="412" text-anchor="middle" fill="#fff" font-family="Arial, sans-serif" font-size="18" font-weight="700">QR 2</text>
  </g>
  <rect x="390" y="640" width="500" height="58" rx="10" fill="#202124"/>
  <text x="640" y="677" text-anchor="middle" fill="#fff" font-family="Arial, sans-serif" font-size="20" font-weight="700">example.com is copied to clipboard</text>
</svg>`;
}
