---
id: "feat-789"
title: "Simulator feedback QR with signed staging links and local capture"
owner: "ekkasit"
priority: "P1"
status: "complete"
start_date: "2026-10-21"
duration: 2
depends_on: []
blocks:
  - "feat-790"
tags:
  - tv
  - feedback
  - simulator
  - developer-experience
---

## Problem

The TV QR hook requires native device verification, preventing a reliable local
simulator feedback flow. Developers need a QR they can scan, a receiving server
on their Mac, and an explicit option to forward a test report to Linear while
keeping existing store builds and production verification unchanged.

## Entry Points — Read These First

1. `docs/plans/2026-10-21-tv-simulator-feedback.md` — scope and acceptance.
2. `apps/tv/src/components/feedback/useFeedbackQr.ts` — QR issuance and cache.
3. `apps/tv/modules/tv-feedback-integrity/` — native runtime verification.
4. `apps/tv/src/lib/feedbackUrl.ts` — normal URL/context contract.
5. `apps/tv-feedback/src/components/PhotoFeedbackFlow.tsx` — phone workflow.
6. `apps/tv-feedback/src/server/` — sessions, uploads and Linear delivery.
7. `docs/roadmap/platform/feat-593-tv-beta-qr-feedback-linear.md` — existing
   physical-device and deployed-service acceptance, outside this local task.

## Grep These

- `EXPO_PUBLIC_TV_FEEDBACK_SIMULATOR_ENABLED`
- `useFeedbackQr`, `LOCAL-PREVIEW`, `createIssue`, `findIssueByReference`

## What To Build

An explicit development-only TV QR mode, separate local report receiving path,
honest local receipts and optional server-side Linear forwarding. The owner also
requested signed simulator links on the existing feedback staging server, usable
from any network/phone without simulator report-count quotas. Keep normal native
verification/limits, upload bounds and token expiry. Reuse the existing form and
annotation components. Document key generation/storage, server setup, phone
access, storage, flags and verification limits.

## Constraints

No production verification bypass, shared app imports, private keys in client
bundles, live production content testing or new store release. Only the selected
feedback staging service is authorized for the signed-link deployment. Simulator
mode must remain disabled in Release and on physical TVs. No success claim for
Linear before issue and selected evidence delivery are confirmed.

## Verification

Follow the plan's deterministic, native, UI, QR decoding, persistence and
release-exclusion checks. Keep simulator, phone/browser, mocked delivery and
authorized live Linear evidence explicitly separate.

## Completion — 27 October 2026

Implemented local capture and optional confirmed Linear forwarding, development-only
native QR guards, signed staging authorization and Keychain issuer instructions.
The one approved local report with annotated image was verified as TV-7.

The original staging web service was deleted on 25 October. With explicit owner
approval, recreated web in the same staging project and deployed to
`https://web-staging-7801.up.railway.app`. Deployment
`064a0a89-d9d4-498a-86ca-216b1f014aad` is successful. Twenty-five live checks
passed using the URLs decoded from the actual Apple TV and Android TV simulators.
Both opened authorized sessions; invalid/cross-origin requests and cross-session
upload access were denied. Apple Menu/Home/Feedback and Android Back/focus/reopen
were verified. Phone-size UI checks cover photo selection, annotation and review;
no new Linear issue or media upload was submitted during the recovery.

Validation: 84 feedback tests including isolated Redis, 68 focused TV tests,
four issuer tests, typechecks, lint and local/Railway production builds passed.
TV and feedback CI jobs passed; an unrelated Admin integration assertion failed
in run 40431538451. The feature ID was renumbered from 756 because current main
allocated that ID to a different feature.

Follow-ups: feat-790 covers the existing release artifacts' old hostname and
physical-device verification; feat-791 covers a production build-tracing warning.
Neither is established by simulator results. Preserve all local evidence in
`.local-tools/feedback-staging-20261027/`; never commit bearer QR files.
