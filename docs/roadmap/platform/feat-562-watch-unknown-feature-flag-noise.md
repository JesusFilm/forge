---
id: "feat-562"
title: "Reconcile Watch feature flag registration and repeated error noise"
owner: "nisal"
priority: "P2"
status: "not-started"
start_date: "2026-09-29"
duration: 1
depends_on: []
blocks: []
tags: [web, feature-flags, observability, operations]
---

## Problem

The September 28 recommendation rollout review found repeated LaunchDarkly
unknown-flag messages that return local defaults. Equal 220-second production
windows contained 2,020 such messages on the prior Web release `c7b8958d6` and
2,073 on `36dba0bc5`. They account for every indexed `status:error` entry in those
windows; this is log volume, not a failed-request rate or evidence that the
recommendation rollout introduced a failure.

The same four keys appear in both windows: `forge.watch.questionPanel`,
`forge.watch.hideBibleQuotes`, `forge.watch.downloadAccountGate` and
`forge.watch.globalBetaTesterCta`. Web's explicit defaults are false. Confirm
which evaluations remain intentional before deciding whether to provision,
rename, retire or change logging for a key. In particular, feat-146 documents
removal of the download account rollout gate; do not recreate retired policy.

2026-10-08: feat-667 retired `forge.watch.globalBetaTesterCta` and its evaluation callsite after the owner ended the Watch beta program. Do not provision or restore that key; continue investigating the other keys under this ticket.

## Entry Points — Read These First

1. `apps/web/src/lib/feature-flags.ts` — app client and explicit fallback values.
2. `packages/feature-flags/src/registry.ts` — flag definitions and local overrides.
3. `packages/feature-flags/src/launchdarkly.ts` — evaluation, SDK initialization
   and logging behavior; read package/app guidance before editing.
4. `docs/roadmap/platform/feat-146-web-user-accounts-download-gate.md` — superseded
   gate and unconditional authenticated download policy.
5. `docs/solutions/platform/launchdarkly-feature-flag-foundation-20260527.md`.
6. `docs/validation/recommendation-traffic-isolation-20260928/README.md` — bounded
   discovery evidence and separation from recommendation acceptance.

## Grep These

`Unknown feature flag`, `questionPanel`, `hideBibleQuotes`, `downloadAccountGate`,
`globalBetaTesterCta`, `booleanVariationDetail`, `LAUNCHDARKLY_SDK_KEY`.

## What To Build

- Reconfirm the actual production flag project/environment and relevant code
  callsites without printing SDK keys, viewer contexts or raw request data.
- Distinguish an intentionally absent/defaulted flag from a missing active
  registration, wrong key/environment, or obsolete evaluation callsite.
- Apply only the evidenced configuration/code repair. Preserve current product
  behavior unless an intentional rollout change has separate authorization.
- Keep real SDK/evaluation failures observable while bounding repeated messages
  for an understood default path. Avoid a blanket error suppression.

## Constraints

No flag enablement, audience expansion, access-gate relaxation or secret changes
are authorized by this discovery ticket. Keep download authentication and
recommendation rollout controls intact. This does not block feat-559/560 or close
their separate storage-capacity and retention follow-ups.

## Verification

Check affected flag fallbacks and both configured/missing cases in focused tests.
Run affected feature-flags/Web lint, typechecks and CI before code changes merge.
After a reviewed repair, compare equal version-scoped indexed windows for these
templates and verify the relevant UI behavior. Distinguish log counts from
request failures; preserve evidence of actual SDK outages.
