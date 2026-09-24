---
id: "feat-551"
title: "TV beta QR feedback with annotated media and Linear delivery"
owner: "ekkasit"
priority: "P1"
status: "in-progress"
start_date: "2026-09-23"
duration: 15
depends_on: []
blocks: []
tags:
  - "tv"
  - "feedback"
  - "linear"
  - "media-upload"
  - "platform"
---

## Problem

TV beta testers need a phone-friendly way to report issues with photos or short
videos and annotate images. The existing Watch feedback flow already sends text
to Linear, but its DOM element picker and phone-browser diagnostics do not
describe a problem on another device.

Planning is updated in
`docs/plans/2026-09-24-tv-feedback-railway-redis-linear.md`. Implementation is in progress. Redis is provisioned in Railway staging. The dedicated TV-scoped Linear key and DeviceCheck-only Apple key are configured there. On 2026-09-25, the server Linear client created TV-1 and uploaded/attached a synthetic PNG and MP4; reference reconciliation found the same issue. Turnstile, remaining enforcement configuration, deployment of the replacement service, Apple TV issuer verification, and phone/physical-device acceptance remain open.

## Entry Points — Read These First

Selected TV entry design: `docs/plans/2026-09-25-tv-feedback-navigation-and-contextual-actions.md`.
Keep the Home Feedback navigation tab and add contextual actions on details,
players and secondary pages. Shared destination title: `The beta testing`.
The UI extension is implemented locally and awaits physical-device acceptance.

Android Open Testing anti-spam plan: `docs/plans/2026-09-23-android-tv-single-use-feedback-grants.md`.
Requires attested app-origin QR issuance, daily single-use grants, and authorization
before accepting media or queuing Linear delivery. Implemented locally; native
Android build, Google Play credentials, physical device verification, and
production enforcement remain open.

Latest UI plan: `docs/plans/2026-09-23-feedback-photo-first-redesign.md`.
The default flow becomes Photo → Draw → Send; the previous wizard is preserved
as Advanced report. Reference 4 defines the drawing popup; reference 5 defines
the receipt with the submitted photo.

1. `docs/plans/2026-09-23-tv-beta-qr-feedback-linear-plan.md` — scope, lifecycle,
   security, proposed file map, release gates, and research.
2. `apps/web/src/components/FeedbackModal.tsx` and
   `apps/web/src/lib/feedback.ts` — reference UX/contracts only; no cross-app
   imports.
3. `apps/web/src/lib/feedback-linear.ts` and
   `apps/web/src/lib/feedback-action-core.ts` — server-only Linear precedent and
   existing limits. Read the current implementation branch: local main was
   older than inspected `origin/main` during planning.
4. `apps/tv/src/components/settings/SettingsScreen.tsx` — minimal QR entry point.
5. `apps/tv/src/components/home/QrPanel.tsx` and
   `apps/tv/src/components/profile/SignInQr.tsx` — native TV QR rendering.
6. `docs/solutions/integration-issues/public-watch-server-actions-require-post-aware-edge-routing.md`
   and
   `docs/solutions/platform/yt-video-mapper-backend-app-durable-match-job-upload-poll-process-pattern.md`.

## Grep These

- `FeedbackSubmission`, `FEEDBACK_CATEGORIES`, `selectedElement`
- `createLinearFeedbackIssue`, `WEB_FEEDBACK_LINEAR_API_KEY`
- `SettingsScreen`, `buildQrMatrix`, `quietZone`, `createFocusMemory`
- Proposed: `FeedbackReport`, `FeedbackAttachment`, `FeedbackDeliveryJob`
- Proposed: `delivery_unknown`, `tvContext`, `phoneContext`

## What To Build

1. A standalone `apps/tv-feedback` mobile form with a Watch-inspired four-step flow,
   English/Thai copy, optional identity, and a review screen.
2. Private uploads, bounded validation/normalization, progress/retry, and an
   image editor for drawing, arrows/shapes, text, undo, and opaque redaction.
   Every mark must remain selectable so the tester can move or delete it before
   submission; the review preview must show the exact final image.
3. Redis-backed grant, session, quota, and submission state; direct server-side
   Linear issue and final evidence delivery, with no PostgreSQL, private bucket,
   or delivery worker.
4. An app-owned QR screen reached from TV Settings, preserving remote focus
   and all player layouts.
5. Honest receipt states, ambiguous-write reconciliation, persistent abuse
   limits, least-privilege credentials, and retention cleanup.

## Constraints

- The user approved implementation; keep this ticket in progress until the
  reviewed staging and device acceptance gates pass.
- Keep production Watch and its existing feedback form unchanged.
- No cross-app imports, admin content schema changes, or shared secrets in QR
  URLs/client bundles.
- TV diagnostics and phone diagnostics must remain distinct.
- No direct browser-to-Linear media PUT, no publicly readable bucket, and no
  original/unredacted image sent to Linear automatically.
- No automatic video markup, TV screen capture, AI triage, or duplicate merging
  in the first release.
- Do not blindly retry an ambiguous Linear issue-create operation.
- Use normal reviewed PR-to-main deployment; no production publishing in the
  planning task.

## Verification

- Scoped unit/integration tests, formatting, lint, typecheck, production build,
  and Playwright flows for the new app.
- Real iPhone Safari and Android Chrome upload, annotation, Thai text, media
  compatibility, network interruption, and retry checks.
- Physical Apple TV and Chromecast/Android TV couch-distance QR scans and
  Back/focus restoration, not simulator-only evidence.
- An approved non-production Linear issue with visible final images and
  playable video; retry/restart/partial-failure proof without duplicate issues.
- Ownership/CSRF/anti-bot/byte-limit/redaction/retention tests and measured
  mobile page-load performance.
