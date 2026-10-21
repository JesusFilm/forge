---
id: "feat-756"
title: "Simulator feedback QR with signed staging links and local capture"
owner: "ekkasit"
priority: "P1"
status: "in-progress"
start_date: "2026-10-21"
duration: 2
depends_on: []
blocks: []
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
