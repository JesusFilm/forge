# Recommendation follow-through validation

Status: implementation checkpoint; final review, CI, release and production
verification remain pending. Branch `codex/recommendation-analytics-followup`.

## Verified so far

- Serialization/token-boundary unit and production-adapter tests: 80 checks.
- Admin full suite at the initial mode implementation: 7,234 passed, five failed
  under simultaneous full-app load. The three affected unrelated suites passed
  all 131 tests with two workers; no timeout or assertion was relaxed.
- Web full suite at the same checkpoint: 4,388 passed, one translation-catalog
  test timed out. Its isolated suite passed all 458 tests with one worker.
- Recommendation unit/native run: 601 passed and one failed because the shared
  disposable database had not yet applied 0098. After normal migration deploy
  applied 0097 and 0098, the viewer lifecycle suite passed both tests. Two Redis
  tests were skipped in this database run; Redis code is outside this change.
- Mode native tests include accepted preview → profile facet → candidate
  performance, minimum independent-profile evidence, conflicting replay,
  withdrawal, reset and simultaneous deletion/publication. The concurrent test
  retains immutable playback facts while leaving no deleted profile influence.
- Hero/Watch renderer/navigation plus mode collector React tests: 148 passed,
  one existing todo. Recorder lifecycle tests also passed after automatic
  identity initialization was ordered before standalone context creation.
- Production-adapter native fixtures and the public disposable database apply
  the actual migrations. Generated Prisma clients come from `prisma generate`.

These are intermediate counts. Further changes receive targeted validation and
the final release must also pass builds, types, formatting, lint and CI.

## Browser evidence and loading cost

`viewing-mode-browser.json` contains five baseline/current loads per variant and
a real-media journey through the production recorder. The fixture uses a native
video stream, the actual overlap geometry helper, React production build and a
synthetic episode endpoint. It does **not** establish a full Watch/Mux-page or
production result.

- Muted preview recorded 30,668ms without a manual attempt or start.
- Covering the sticky preview stopped mode credit while media continued.
- Watch now switched to sound-on activated evidence (10,217ms observed).
- Preview and activated playback used one claimed episode.
- Compressed fixture bundle: 65,544 → 66,401 bytes (+857 bytes).
- Median DOMContentLoaded: 29.4 → 32.8ms. Maximum observed long task: 0 → 52ms.
  These small fixture samples bound component cost; they are not a field loading
  performance claim. Whole-page verification remains part of release checks.

## Interpretation and rollout

Equal sound-on/off qualification proves implementation parity, not actual
attention. The viewer's distinct-video preference and independent per-video
evidence are bounded proxies. Sound-off recommendation effects will be sparse
until new observations accumulate; historical missing manual-play facts cannot
be backfilled as muted viewing. Causal uplift requires the mature controlled
comparison, including assigned units with no exposure.

Use `RECOMMENDATION_VIEWING_MODE_ENABLED=false` for a narrow rollback through
normal deployment configuration. It leaves player behavior, raw evidence,
profile erasure and ordinary recommendation ranking available. Keep For you
held off. Do not expand Recommendation Visibility or locale/source scope.

## Final local review checkpoint

- Recommendation suite with production PostgreSQL adapter: **617 passed**, two
  Redis-only skips. Subsequent tiny-clip, overlap and Admin-history assertion
  changes have focused rechecks; no assertion or timeout was weakened.
- Full Admin: **7,253 passed**, one stale history-copy assertion failed and was
  updated for reconstructed history; 285 opt-in skips and one existing todo.
- Full Web: **4,397 passed**, one unchanged homepage render-count assertion
  failed; all 70 tests in that file passed in isolation. Ten opt-in skips and one
  existing todo. CI on the final revision remains the merge gate.
- Admin and Web production builds passed with local/CI configuration. Web types,
  actual migrations and workflow build registration checks passed. Frozen-lockfile
  installation includes the other task's Expo and Redis patch changes.
- Production baseline full Watch-page samples are in
  `page-performance-before.json`: initial LCP 1,512ms, warm samples 556/672ms;
  muted preview remained playing and Watch now remained available. These are
  synthetic browser observations, not field-percentile claims.
- `quality-readiness-results.json` is a live read-only capture at
  2026-09-16T00:21:39.730Z. It shows a semantic control pointer, zero assignments
  and no shadow decisions/runs. The seeded session A/A does not satisfy the new
  profile-unit protocol. No approval or evaluation pass was fabricated.
- `compound-review.md` records the sequential Compound Engineering review,
  corrected findings, migration/contract checks and remaining empirical gates.
