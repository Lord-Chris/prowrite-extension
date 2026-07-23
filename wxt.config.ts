import { defineConfig } from "wxt";
import { copyFileSync, mkdirSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Copy icons immediately on config load
function ensureIcons() {
  const iconsSrc = join(__dirname, "public", "icons");
  const iconsDst = join(__dirname, "dist", "chrome-mv3", "icons");
  if (existsSync(iconsSrc)) {
    mkdirSync(iconsDst, { recursive: true });
    for (const f of readdirSync(iconsSrc)) {
      copyFileSync(join(iconsSrc, f), join(iconsDst, f));
    }
  }
}

// Run immediately
ensureIcons();

export default defineConfig({
  manifestVersion: 3,
  srcDir: "src",
  outDir: "dist",
  publicDir: "public",
  manifest: {
    name: "ProWrite",
    description: "Save jobs and generate tailored documents from any job board",
    version: "0.1.1",
    permissions: ["storage", "activeTab", "scripting"],
    host_permissions: ["*://*.prowrite.app/*"],
    icons: {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png",
    },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
  },
  hooks: {
    "build:manifestGenerated": (wxt, manifest) => {
      // In dev mode (serve or build:development), add localhost permissions
      const isDevMode = wxt.config.command === "serve" || wxt.config.mode === "development";
      
      if (wxt.config.command === "serve") {
        // In serve mode, remove default_popup so chrome.action.onClicked fires
        // and the background script can capture page content before opening the popup
        if (manifest.action) {
          delete manifest.action.default_popup;
        }
      }
      
      if (isDevMode) {
        // Allow localhost for dev auth bridge
        if (!manifest.host_permissions) {
          manifest.host_permissions = [];
        }
        if (!manifest.host_permissions.includes("http://localhost/*")) {
          manifest.host_permissions.push("http://localhost/*");
        }
      }
    },
    "build:done": ensureIcons,
  },
});
