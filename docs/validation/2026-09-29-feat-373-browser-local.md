---
title: feat-373 local real-browser exposure proof
date: 2026-09-29
feature: feat-373
status: local-proof
---

# Actual browser and Admin persistence

`apps/web/scripts/verify-watch-exposure-browser.mjs` bundles the actual
`WatchExposureBoundary` and its visibility/dwell hook into a production React
fixture. Its bounded loopback HTTP transport verifies a fixture-only server
signature, then calls the real Admin `issueWatchSurfaceDelivery` and
`recordWatchSurfaceExposureBatch` services against the parent-owned migrated
`forge_exposure_acceptance` disposable PostgreSQL database. No production data,
flags, sessions, deployment or authentication was used. Scratch bundles remain
under `work/watch-exposure-browser/`; archive that owned scratch outside the
repository before running global formatting/commit hooks.

Chromium **149.0.7827.55** passed **29 checks**. Actual Admin persistence
accepted **33 batches** with **zero fixture ingestion errors**. The
sanitized receipt contains **316 served** and **316 v2 rendered**
facts; identifiers and windows are omitted from the retained aggregate JSON.
No client request contains `kind: served`. A request-derived closing-script
attack also remains exact JSON data without executing injected script; the
HTML shell is static; configuration travels as `application/json` with
`nosniff` and is parsed as data by the fixture bundle.

The pageshow observer is installed before the shared JSON fetch so slow
configuration responses cannot hide navigation events. The exposure-request
recorder is installed after config, so it does not claim that config waits for
load.

The browser exercised below-fold rendered cards without eligible impressions,
scroll followed by one-second continuous dwell, leaving/returning without a
second eligible fact, selected events before eligible occurrence, ordinary
anchor navigation with departure telemetry, reordered DOM positions remaining
v1 where the trusted source no longer matches, separate placements for repeated
blocks, failed issuance falling back to v1, and real Chromium occlusion tracking
rejecting overlay-covered dwell. A deliberately lost server response committed
served facts, then retried the same attempt and returned the same replay window.
The fixture reused an identical cached source descriptor on a fresh navigation;
the server issued a different delivery window.

History back navigation created a separate window. Native BFCache persisted
pageshow observed: **false**. Document visibility and prerender activation
cases are explicitly **property simulations in real Chromium**; they prove the
actual boundary/hook lifecycle but cannot establish native background-tab or
native prerender cache behavior. A separate probe showed this headless Chromium
keeps both tabs visible after `bringToFront` and CDP freeze/resume, so the report
does not claim a native hidden-tab observation.

# Comparative loading measurement

Eight 70-card runs alternated baseline/enabled in one browser context, with the
same production React bundle, shared configuration fetch and a 400 ms resource
load gate. The static-shell fixture adds one configuration fetch in both modes;
its resource totals are three/six rather than the earlier inline fixture's
two/five. All enabled
issuance requests began after document load. Four samples per mode are retained
in the JSON. Median results:

| Metric       | Baseline | Enabled | Enabled minus baseline |
| ------------ | -------: | ------: | ---------------------: |
| DCL (ms)     |    24.55 |   24.15 |                  -0.40 |
| Load (ms)    |   412.10 |  415.30 |                  +3.20 |
| FCP (ms)     |       42 |      36 |                  -6.00 |
| Resources    |        3 |       6 |                  +3.00 |
| Script bytes |   608421 |  608421 |                  +0.00 |

Ordinary selected-anchor navigation completed in **63 ms**, without
waiting for telemetry. The baseline shares the fixture bundle and isolates
boundary initialization plus its incremental requests; it does **not** measure
the size of adding this feature to the full Next application. Resource counts
include post-load delivery/telemetry. These small local samples detect a major
loading-path regression but cannot support a production performance claim.

# Reproduction and acceptance limits

With the designated disposable database running and migrated through 0105:

```bash
node apps/web/scripts/verify-watch-exposure-browser.mjs
```

The script rejects other database hosts/names, writes only its unique bounded
fixture placements, never removes the parent's database/container, and always
closes its browser/server/Prisma client. Every rerun replaces sanitized evidence
for that run. The fixture signature is a deliberately public local test key;
actual Web signer/key rotation, descriptor origin verification and Web HTTP
traffic fences have separate focused tests.

This is local component/service integration proof, not full deployed Watch
behavior, real HTML cache reconciliation or the authorized Admin acceptance
session. Deployed Admin denominators, CTR, duplicates, ingestion health and
coverage still need reconciliation after normal automatic rollout. Independent
Admin/Web builds may finish in either order; new Web has tested old-Admin
fallback to v1/unknown coverage. Acceptance requires the Admin migration and
all actual service revisions to be healthy.
feat-373 must remain in progress while that acceptance gate is outstanding.
