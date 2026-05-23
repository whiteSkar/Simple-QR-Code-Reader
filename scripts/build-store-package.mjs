import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const extensionDir = path.join(projectRoot, "extension");
const releaseDir = path.join(projectRoot, "release");
const manifest = JSON.parse(await readFile(path.join(extensionDir, "manifest.json"), "utf8"));
const packageBaseName = `simple-qr-code-reader-${manifest.version}`;
const packagePath = path.join(releaseDir, `${packageBaseName}.zip`);
const checksumPath = path.join(releaseDir, `${packageBaseName}.sha256`);
const normalizedPackageDate = new Date(2024, 0, 1, 0, 0, 0, 0);

await rm(releaseDir, { force: true, recursive: true });
await mkdir(releaseDir, { recursive: true });

await packageExtension();
await writeChecksum();

console.log(`Created ${path.relative(process.cwd(), packagePath)}`);
console.log(`Created ${path.relative(process.cwd(), checksumPath)}`);

async function packageExtension() {
  await rm(packagePath, { force: true });
  const stagingRoot = await mkdtemp(path.join(tmpdir(), "simple-qr-code-reader-package-"));
  const stagedExtensionDir = path.join(stagingRoot, "extension");

  try {
    await cp(extensionDir, stagedExtensionDir, { recursive: true });
    await normalizeTimestamps(stagedExtensionDir);
    await execFileAsync(
      "zip",
      [
        "-X",
        "-D",
        "-q",
        "-r",
        packagePath,
        ".",
        "-x",
        "*.DS_Store",
        "-x",
        "__MACOSX/*"
      ],
      { cwd: stagedExtensionDir }
    );
  } finally {
    await rm(stagingRoot, { force: true, recursive: true });
  }
}

async function normalizeTimestamps(filePath) {
  const fileStat = await stat(filePath);

  if (fileStat.isDirectory()) {
    const entries = await readdir(filePath);
    for (const entry of entries) {
      await normalizeTimestamps(path.join(filePath, entry));
    }
  }

  await utimes(filePath, normalizedPackageDate, normalizedPackageDate);
}

async function writeChecksum() {
  const bytes = await readFile(packagePath);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  await writeFile(checksumPath, `${checksum}  ${path.basename(packagePath)}\n`);
}
