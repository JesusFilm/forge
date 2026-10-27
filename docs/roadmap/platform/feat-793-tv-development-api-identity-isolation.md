---
id: "feat-793"
title: "Isolate TV development identities when switching catalogue APIs"
owner: "ekkasit"
priority: "P1"
status: "complete"
start_date: "2026-10-27"
duration: 1
depends_on: []
blocks: []
tags:
  - tv
  - developer-experience
  - recommendations
---

## Problem

The owner requested real production catalogue/playback on the two QA simulators,
while retaining signed simulator feedback on staging. The previous offline proxy
issued synthetic recommendation identities into the ordinary SecureStore slot.
Those identities must not be reused against a real backend.

## Implementation and constraints

- Scope development recommendation identity storage to the normalized GraphQL
  endpoint in `apps/tv/src/lib/recommendations/client.ts`.
- Keep the Release key unchanged. Preserve personalization choice and app data.
  Do not migrate the unscoped development identity to any real endpoint.
- Update only ignored simulator configuration and the local launcher to use the
  existing production catalogue/fleet configuration. Keep feedback separate at
  `https://web-staging-7801.up.railway.app/tv/simulator`.
- Do not change production server configuration, content, store artifacts or
  publish synthetic recommendation evidence.

## Verification

Test release key compatibility, development endpoint separation and legacy
fixture identity exclusion. Verify real playback on both simulators and fresh
feedback QR authorization. Report coverage separately from recommendation
service errors under `docs/analytics-and-recommendation-policy.md`.

## Completion — 27 October 2026

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
