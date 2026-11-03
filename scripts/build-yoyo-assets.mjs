import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const srcImgDir = path.join(rootDir, "src", "assets", "images");
const outDir = path.join(rootDir, "public", "yoyo");

fs.mkdirSync(outDir, { recursive: true });

function findLatestMaster(prefix) {
  const matches = fs
    .readdirSync(srcImgDir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".jpg"))
    .sort();
  if (matches.length === 0) {
    throw new Error(`Missing source image for prefix: ${prefix}`);
  }
  return path.join(srcImgDir, matches[matches.length - 1]);
}

const mobileSrc = findLatestMaster("yoyo_liquid_glass_mobile_");
const desktopSrc = findLatestMaster("yoyo_liquid_glass_desktop_");
const capsuleSrc = findLatestMaster("yoyo_capsule_caustic_lens_");

function runConvert(args) {
  execFileSync("convert", args, { stdio: "inherit" });
}

const mobileWidths = [
  { w: 360, qAvif: 46, qWebp: 68, qJpg: 72 },
  { w: 540, qAvif: 50, qWebp: 72, qJpg: 76 },
  { w: 768, qAvif: 54, qWebp: 76, qJpg: 80 },
  { w: 1152, qAvif: 56, qWebp: 78, qJpg: 82 },
];

for (const { w, qAvif, qWebp, qJpg } of mobileWidths) {
  const baseArgs = [
    mobileSrc,
    "-strip",
    "-filter",
    "Lanczos",
    "-resize",
    `${w}x`,
    "-unsharp",
    "0x0.6+0.45+0.02",
  ];
  runConvert([...baseArgs, "-quality", String(qAvif), path.join(outDir, `mobile-${w}w.avif`)]);
  runConvert([...baseArgs, "-quality", String(qWebp), path.join(outDir, `mobile-${w}w.webp`)]);
  runConvert([
    ...baseArgs,
    "-sampling-factor",
    "4:2:0",
    "-interlace",
    "Plane",
    "-quality",
    String(qJpg),
    path.join(outDir, `mobile-${w}w.jpg`),
  ]);
}

const desktopWidths = [
  { w: 640, qAvif: 46, qWebp: 68, qJpg: 72 },
  { w: 1024, qAvif: 52, qWebp: 74, qJpg: 78 },
  { w: 1376, qAvif: 55, qWebp: 77, qJpg: 80 },
  { w: 2064, qAvif: 56, qWebp: 78, qJpg: 82 },
];

for (const { w, qAvif, qWebp, qJpg } of desktopWidths) {
  const baseArgs = [
    desktopSrc,
    "-strip",
    "-filter",
    "Lanczos",
    "-resize",
    `${w}x`,
    "-unsharp",
    "0x0.6+0.45+0.02",
  ];
  runConvert([...baseArgs, "-quality", String(qAvif), path.join(outDir, `desktop-${w}w.avif`)]);
  runConvert([...baseArgs, "-quality", String(qWebp), path.join(outDir, `desktop-${w}w.webp`)]);
  runConvert([
    ...baseArgs,
    "-sampling-factor",
    "4:2:0",
    "-interlace",
    "Plane",
    "-quality",
    String(qJpg),
    path.join(outDir, `desktop-${w}w.jpg`),
  ]);
}

// Rotate vertical 1:1 capsule lens 90deg into horizontal 2.1:1 pill aspect ratio
const capsuleWidths = [
  { w: 220, qAvif: 50, qWebp: 72, qJpg: 76 },
  { w: 440, qAvif: 55, qWebp: 78, qJpg: 82 },
  { w: 660, qAvif: 58, qWebp: 80, qJpg: 84 },
];

for (const { w, qAvif, qWebp, qJpg } of capsuleWidths) {
  const baseArgs = [
    capsuleSrc,
    "-strip",
    "-rotate",
    "90",
    "-gravity",
    "center",
    "-crop",
    "880x420+0+0",
    "+repage",
    "-filter",
    "Lanczos",
    "-resize",
    `${w}x`,
    "-unsharp",
    "0x0.55+0.5+0.02",
  ];
  runConvert([...baseArgs, "-quality", String(qAvif), path.join(outDir, `capsule-${w}w.avif`)]);
  runConvert([...baseArgs, "-quality", String(qWebp), path.join(outDir, `capsule-${w}w.webp`)]);
  runConvert([
    ...baseArgs,
    "-sampling-factor",
    "4:2:0",
    "-interlace",
    "Plane",
    "-quality",
    String(qJpg),
    path.join(outDir, `capsule-${w}w.jpg`),
  ]);
}

const summary = fs
  .readdirSync(outDir)
  .sort()
  .map((name) => {
    const bytes = fs.statSync(path.join(outDir, name)).size;
    return `${name.padEnd(24)} ${(bytes / 1024).toFixed(1).padStart(6)} KB`;
  });

console.log("Generated responsive YOYO assets:\n" + summary.join("\n"));
