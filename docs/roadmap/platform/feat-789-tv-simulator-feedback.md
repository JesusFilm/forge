---
id: "feat-789"
title: "Simulator feedback, local capture and isolated development identities"
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

## Development API identity isolation and teammate setup

The development identity follow-up is consolidated here because main allocated
feat-793 to an unrelated retention feature before this PR merged. The completed
scope and verification are retained below; no runtime behavior was removed.

### Problem

The owner requested real production catalogue/playback on the two QA simulators,
while retaining signed simulator feedback on staging. The previous offline proxy
issued synthetic recommendation identities into the ordinary SecureStore slot.
Those identities must not be reused against a real backend.

### Implementation and constraints

- Scope development recommendation identity storage to the normalized GraphQL
  endpoint in `apps/tv/src/lib/recommendations/client.ts`.
- Keep the Release key unchanged. Preserve personalization choice and app data.
  Do not migrate the unscoped development identity to any real endpoint.
- Update only ignored simulator configuration and the local launcher to use the
  existing production catalogue/fleet configuration. Keep feedback separate at
  `https://web-staging-7801.up.railway.app/tv/simulator`.
- Do not change production server configuration, content, store artifacts or
  publish synthetic recommendation evidence.

### Verification

Test release key compatibility, development endpoint separation and legacy
fixture identity exclusion. Verify real playback on both simulators and fresh
feedback QR authorization. Report coverage separately from recommendation
service errors under `docs/analytics-and-recommendation-policy.md`.

### Completion — 27 October 2026

The owner superseded the staging-catalogue request with production catalogue and
playback, keeping simulator feedback on its separate signed staging path. Both
simulators were switched to the existing production consumer configuration; the
offline proxy was stopped. No production server settings or content were changed.
Normal app traffic uses fresh real recommendation identities rather than the
unscoped fixture identity. Personalization choice and other app data are retained.

23 focused identity/client tests, TV typecheck and scoped lint passed. JESUS video
playback was observed on both platforms and recorded. Both refreshed QR codes
decoded to the feedback staging server and obtained HTTP 201 signed sessions.

The local Desktop launcher now starts against production by default, refreshes
the feedback link independently, and stops the old Metro/app processes before
editing environment values to avoid Fast Refresh races. Store artifacts remain
unchanged. Local evidence is in `.local-tools/tv-staging-playback-20261027/`.

Portable teammate/AI onboarding is documented in
`apps/tv/SIMULATOR-TESTING.md`, including native build fallbacks, separated API
configuration, signed-link renewal and acceptance limits.
