import { defineConfig } from "wxt";

export default defineConfig({
  manifestVersion: 3,
  srcDir: "src",
  outDir: "dist",
  manifest: {
    name: "ProWrite",
    description: "Save jobs and generate tailored documents from any job board",
    version: "0.1.0",
    permissions: ["storage", "activeTab", "scripting"],
    host_permissions: ["*://*.prowrite.app/*"],
    icons: {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png",
    },
  },
});
