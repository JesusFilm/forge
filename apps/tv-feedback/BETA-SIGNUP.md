# Android TV beta requests

## Guide media update — 2026-09-28

Railway staging deployment `e61b2d9a-34ae-44e6-a808-aa75937cd15f` is successful. `/beta/index.html` includes the approved popup tutorials, official app icons, Join-first Apple steps, and Android admin-approval guidance. The preview switcher and demo request handler are excluded; the existing protected signup handler is preserved.

Public tutorial videos, captions, thumbnails, and icons are in `public/beta/media/`. Videos load only after the viewer opens a tutorial (`preload=none`, no initial source). Both live MP4 URLs support HTTP 206 range requests. Desktop playback for both platforms, the phone popup layout, form opening, and rejection of an invalid verification token were checked. All 23 tests and the Next build passed. This update did not submit another valid signup request.

Serve `/beta/index.html` from this service. Its form posts to `/api/beta-requests` on the same origin. The public guide can link here; never put a Google write credential or Turnstile secret in the HTML.

Server configuration:

- `BETA_REQUESTS_SPREADSHEET_ID=15ld-kvhFH1aXW-s2Tr2w6hEWA9AOHJdj2fe_POOoUD0`
- `BETA_REQUESTS_GOOGLE_SERVICE_ACCOUNT_JSON`: optional dedicated service account JSON. Defaults to the existing server-only `FEEDBACK_GOOGLE_SERVICE_ACCOUNT_JSON` account, which has Editor access to this sheet.
- Existing `TURNSTILE_SECRET_KEY`, `TURNSTILE_HOSTNAMES`, and `REDIS_URL`.

The destination sheet is owned by `ekkasit.samathimankong@tandem.org.nz`. Enable Google Sheets API in the service account project. Share only the destination spreadsheet with that service account as Editor. The `Sheet1` tab columns are Requested at, Google account email, Platform, Status.

The widget site key is `0x4AAAAAAFCyqm5bfnxjLhKf`. Permit the deployment hostname in Cloudflare and `TURNSTILE_HOSTNAMES`. Signup requires the `tv_beta_signup` action and never bypasses verification in development. Use official test keys for automated local end-to-end testing, never in public deployments.

The endpoint applies a global request limit and atomic per-email lock before appending a RAW Pending row. An ambiguous write failure retains the one-hour lock to prevent immediate duplicate writes; inspect Sheets before retrying. This records requests only; approval, Google Play access and invitation email remain manual.

## Verified on 2026-09-28

The Tandem-owned sheet is shared with the existing service account as Editor. Sheets API access succeeds. Railway staging has the spreadsheet ID configured. Deployment `9225adea-ba3c-4407-bdc3-ac4faf1dfb02` is healthy; a browser request passed the real Turnstile widget, received a saved confirmation, and created one `browser-signup-qa@example.com` Pending row. An invalid token received HTTP 403. The sheet also contains a clearly labeled synthetic direct-write QA row.

All 23 tests, TypeScript, scoped ESLint and the production build pass. The simplified guide source is prepared in the Sites checkout; publication is blocked by the bundled `site-workflow.mjs` disappearing from the local plugin installation. Production server changes still follow the repository PR-to-main flow.
