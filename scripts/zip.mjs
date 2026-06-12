import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const distDir = join(root, "dist", "chrome-mv3");

const manifest = JSON.parse(readFileSync(join(distDir, "manifest.json"), "utf-8"));
const version = manifest.version;
const filename = `prowrite-extension-${version}-chrome.zip`;
const outPath = join(root, "dist", filename);

execSync(`cd "${distDir}" && zip -r "${outPath}" .`, { stdio: "inherit" });

console.log(`\n  ✔ Zipped: dist/${filename}`);
