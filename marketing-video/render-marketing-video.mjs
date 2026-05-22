import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdir, rm } from "node:fs/promises";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const width = 1280;
const height = 720;
const fps = 30;
const outputPath = path.join(__dirname, "renders", "simple-qr-code-reader-promo-1.0.mp4");
const framesDir = path.join(tmpdir(), `simple-qr-code-reader-video-frames-${Date.now()}`);
const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

await mkdir(path.dirname(outputPath), { recursive: true });
await mkdir(framesDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: false,
  args: [
    `--window-size=${width},${height}`,
    "--hide-scrollbars",
    "--mute-audio"
  ]
});

try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.join(__dirname, "index.html")).href, { waitUntil: "load" });
  await page.waitForFunction(() => window.__marketingRender && window.__marketingRender.duration);

  const duration = await page.evaluate(() => window.__marketingRender.duration);
  const totalFrames = Math.round(duration * fps);

  for (let frame = 0; frame < totalFrames; frame += 1) {
    const time = frame / fps;
    await page.evaluate((t) => window.__marketingRender.seek(t), time);
    await page.screenshot({
      animations: "disabled",
      path: path.join(framesDir, `frame-${String(frame).padStart(5, "0")}.png`),
      type: "png"
    });
  }

  await page.close();
  await encodeVideo();
} finally {
  await browser.close();
  await rm(framesDir, { force: true, recursive: true });
}

console.log(`Rendered ${path.relative(process.cwd(), outputPath)}`);

async function encodeVideo() {
  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-framerate",
      String(fps),
      "-i",
      path.join(framesDir, "frame-%05d.png"),
      "-vf",
      "format=yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "18",
      "-movflags",
      "+faststart",
      outputPath
    ],
    { maxBuffer: 1024 * 1024 * 16 }
  );
}
