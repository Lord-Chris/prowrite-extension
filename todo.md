## Done

- [x] Add Profile name to top right of window for easy identification.
  - Fetches name from auth `user_metadata` or `contact_info` table
  - Displays initials avatar (green circle) + name text in header-right
  - Files: `auth.ts` (`getUserDisplayName`, `getInitials`), `App.tsx` (state, header render), `style.css` (`.header-right`, `.profile-badge`, `.profile-avatar`, `.profile-name`)

- [x] Add a retry button on the error page, if it's a 5xx error.
  - `AuthFetchError` class propagates `statusCode` from failed API calls
  - Error state includes optional `statusCode` and `retry` callback
  - Shows "Server Error" / "Client Error" badge + Retry button (danger style) for 5xx errors
  - Retry re-runs the failed operation with the same parameters
  - Files: `api.ts` (`AuthFetchError`, `authFetch`), `App.tsx` (state type, catch blocks, error UI), `style.css` (`.error-badge-*`, `.btn-danger`)

- [x] The Resume and Cover letter download output should use the page settings set in resume builder in prowrite_lovable.
  - `generate-documents` edge function already returned `stylingSnapshot` — extension now reads it
  - `renderResumeHTML()` uses `stylingSnapshot` values for font family, font size, heading font/size/weight, line height, spacing, margins, alignment
  - Respects `sectionOrder` for visibility (`is_visible`) and ordering (`sort_order`) — sections hidden in resume builder won't appear
  - `formatCoverLetterHTML()` also uses font styling from snapshot
  - Defaults to existing behavior (Georgia, 11pt) when no styling is available
  - Files: `App.tsx` (`renderResumeHTML`, `formatCoverLetterHTML`, done state)
