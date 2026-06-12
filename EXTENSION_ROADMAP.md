# ProWrite Browser Extension — Roadmap

## Vision

Turn job hunting from a tab-switching copy-paste marathon into a single click.
The extension is the bridge between any job board and your ProWrite workspace.

## Phase 1: Save & Generate (MVP) — Current

**Status:** Building

One-click save from any job board + generate tailored documents, with smart
clipboard for pasting into application forms.

- [x] Auth bridge: reads Supabase session from web app localStorage
- [ ] Content script: extracts page URL + text from any job board
- [ ] Edge function: AI-based extraction of title, company, description
- [ ] Popup: extract → preview → save & generate → copy to clipboard
- [ ] Smart clipboard: copy resume text, copy cover letter
- [ ] In-app install prompt for browser users

**Supported sites:** Any (AI-based, no site-specific code)

## Phase 2: Intelligent Form Fill

The extension fills application forms on the page with your generated docs.
User still clicks Submit — no auto-submit, no ToS risk.

- [ ] ATS platform detection (Greenhouse, Lever, Ashby, LinkedIn)
- [ ] Field mapper: name → first_name input, email → email input, etc.
- [ ] Resume upload: programmatic file input for generated PDF
- [ ] Cover letter paste: into textarea fields
- [ ] One-click "Fill Application" button in popup
- [ ] AI fallback: detect and map unknown form fields by label text
- [ ] User review step before filling (what's going where)

**Phase 2 philosophy:** Fill the form, let the user press Submit.
We assist, we don't impersonate.

## Phase 3: Auto-Apply Intelligence

Smart application queue — let ProWrite decide where to apply and submit
on your behalf after user approval.

- [ ] Application queue: review → approve → auto-submit
- [ ] Batch apply: apply to multiple similar jobs with one approval
- [ ] Schedule applications at optimal times
- [ ] Auto-reply to screening questions using AI + resume data
- [ ] Company career page detection (beyond major ATS platforms)
- [ ] CAPTCHA detection → pause queue, notify user
- [ ] Compliance: per-platform ToS checks, opt-in per job board

**Phase 3 philosophy:** User approves a batch, ProWrite executes.
Transparent logging of every submission.

## Phase 4: Proactive Job Discovery

Extension becomes a passive job scout.

- [ ] Job feed: extension suggests relevant openings as you browse
- [ ] One-click "Track This" from any job listing without opening it
- [ ] Salary insight: estimated range for posted jobs
- [ ] Company research card: glassdoor rating, growth signals, tech stack
- [ ] Fit score: how well your resume matches the description
- [ ] Duplicate detection: already applied? Shows previous status

## Phase 5: Platform Expansion

- [ ] Firefox add-on
- [ ] Safari web extension
- [ ] Arc boost (if applicable)
- [ ] Mobile: iOS Shortcuts / Android automation
- [ ] Edge add-on

## Technical Debt & Infrastructure

- [ ] E2E tests with Puppeteer on real job board pages
- [ ] Per-ATS form detector test suite
- [ ] Error telemetry (opted-in)
- [ ] Rate limiting for API calls
- [ ] Offline mode: queue actions when disconnected
- [ ] Build CI: auto-package for Chrome Web Store

## How to contribute

Feature requests and bug reports: GitHub Issues.
PRs welcome for new ATS form detectors (see Phase 2).
