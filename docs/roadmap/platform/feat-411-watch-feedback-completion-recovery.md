---
id: "feat-411"
title: "Watch feedback completion and delivery recovery"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-08-21"
duration: 1
depends_on:
  - "feat-399"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "feedback"
  - "linear"
---

## Problem

The native Watch feedback form confirms receipt with generic copy, even when
the person supplied contact information. People who skipped email have no
final opportunity to request an update, and a Linear delivery failure only
offers a retry instead of a reliable support path. The desktop dialog also
uses a bounded panel that clips open suggestion menus and differs from Watch's
full-screen language surface.

## Entry Points — Read These First

1. `apps/web/src/components/FeedbackModal.tsx` — form layout, submission,
   receipt, and failure states.
2. `apps/web/src/lib/feedback-action.ts` — public Server Action boundary.
3. `apps/web/src/lib/feedback-action-core.ts` — validation, rate limiting, and
   generic delivery results.
4. `apps/web/src/lib/feedback-linear.ts` — server-only Linear issue transport.
5. `apps/web/src/components/FeedbackLauncher.test.tsx` — native form behavior.
6. `docs/roadmap/platform/feat-399-watch-native-linear-feedback.md` — native
   feedback security and privacy constraints.

## Grep These

- `submitted`
- `submitFeedback`
- `createLinearFeedbackIssue`
- `delivery_failed`
- `feedback-content-results`
- `Thank you`

## What To Build

1. Render the native feedback flow directly on the full-screen blurred Watch
   overlay, without a separate rounded parent panel or panel clipping.
2. On success, show problem/idea-aware follow-up copy when an email was
   supplied.
3. When email was omitted, offer one final validated email field and attach it
   to the already-created Linear issue through a short-lived opaque receipt;
   never expose a Linear issue id or create a duplicate issue.
4. On Linear delivery failure, preserve the form and offer the official Jesus
   Film Project contact form at `https://www.jesusfilm.org/contact/` in
   addition to retrying.

## Constraints

- Keep Linear credentials and issue ids server-only.
- Bound and validate the late email before sending it to Linear.
- Do not create a second issue when adding contact information.
- Preserve the entered form after delivery failures.
- Keep the modal accessible and responsive at desktop and mobile sizes.

## Verification

- Component tests cover category-aware receipt copy, late-email success and
  validation, support fallback, retry, and full-screen/unclipped layout.
- Server tests cover opaque receipt creation, tamper/expiry rejection, and
  sanitized Linear comment creation.
- Web typecheck, focused lint, formatting, and focused tests pass.
- Browser QA covers desktop and mobile success/failure states and the open
  drop-down state against the provided references.
- Page-load verification confirms the lazy feedback chunk remains absent from
  initial Watch resources until the launcher is used.
