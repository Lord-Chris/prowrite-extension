# ProWrite Browser Extension

Save jobs and generate tailored resumes and cover letters from any job board.

## Setup

```bash
npm install
```

## Development

```bash
npm run dev
```

Opens WXT dev mode with HMR. The content script includes `*://localhost:*/*` automatically when `import.meta.env.DEV` is true.

## Build

```bash
npm run build
```

Outputs to `dist/chrome-mv3/`. Postbuild step strips `default_popup` from manifest (popup is opened via `chrome.windows.create`).

## Load Unpacked (testing)

1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `dist/chrome-mv3/`

## Release

```bash
npm run release <version>
```

Example: `npm run release 0.1.1`

This bumps the version in `package.json` and `wxt.config.ts`, builds, and creates the zip.

To build and zip without bumping:

```bash
npm run zip
```

Output: `dist/prowrite-extension-<version>-chrome.zip`

## Pre-deploy Checklist

Run through this before every Chrome Web Store submission:

- [ ] Version bumped (run `npm run release <version>`)
- [ ] `npm run zip` succeeds
- [ ] `default_popup` is stripped from the manifest inside the zip
- [ ] Content script matches only `*://*.prowrite.app/*` (no localhost)
- [ ] `host_permissions` are `*://*.prowrite.app/*` only
- [ ] `PROWRITE_APP_URL` points to `https://my.prowrite.app` in production
- [ ] Icons (16/48/128) are included in the zip
- [ ] Privacy policy URL is set in the Web Store listing: `https://prowrite.app/privacy`
- [ ] Permissions justification is accurate: `storage`, `activeTab`, `scripting`
- [ ] Tested in a clean Chrome profile

## Upload to Chrome Web Store

1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/)
2. Upload `dist/prowrite-extension-<version>-chrome.zip`
3. Update listing details (description, screenshots, promo tiles)
4. Submit for review

## Architecture

- **WXT** — build tool for cross-browser extensions
- **React 18** — popup UI
- **Supabase** — auth bridge reads session from web app's localStorage (`sb-idehaaowusoylwtgnndh-auth-token`)
- **Edge functions** — `extract-job-details`, `generate-documents`
- **Chrome MV3** — manifest version 3
