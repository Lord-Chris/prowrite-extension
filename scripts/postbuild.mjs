import { copyFileSync, readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dist = join(root, "dist", "chrome-mv3");

// 1. Copy public icons
const iconsSrc = join(root, "public", "icons");
const iconsDst = join(dist, "icons");
if (existsSync(iconsSrc)) {
  mkdirSync(iconsDst, { recursive: true });
  for (const f of readdirSync(iconsSrc)) {
    copyFileSync(join(iconsSrc, f), join(iconsDst, f));
  }
}

// 2. Remove default_popup from manifest (we open via chrome.windows.create)
const manifestPath = join(dist, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
if (manifest.action) {
  delete manifest.action.default_popup;
}
writeFileSync(manifestPath, JSON.stringify(manifest));

console.log("Postbuild: icons copied, default_popup removed");
