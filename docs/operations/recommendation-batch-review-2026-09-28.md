# Recommendation batch review — September 28, 2026

This record covers the independent implementation and evidence work for
[feat-387](../roadmap/content-discovery/feat-387-profile-conditioned-directional-cowatch.md),
[feat-373](../roadmap/content-discovery/feat-373-watch-surface-impressions-ctr.md), and
[feat-545](../roadmap/content-discovery/feat-545-recommendation-monitoring-and-telemetry-closeout.md).
The integration started from `7bfed3f9fc228bfd5e3353697f91d7e6a05c9464`
and was refreshed against main at
`2cc8105ffb00a9f595cefe10594bd8537561099f` after the independent storage
change landed.

## Authority and release boundary

This batch authorizes implementation, local verification, shadow evaluation and
focused pull requests. It does not authorize changing production flags, widening
the personalization pilot, activating experiments, promoting a candidate lane,
installing the deferred Datadog resources, or deploying local worktree code.
Production verification must follow the normal PR-to-main release path.

On September 28, the user authorized merging the reviewed batch through that
normal path. Ordinary automatic deployment is permitted; the restrictions on
flags, pilot scope, experiments, candidate promotion and manual deployment remain.

Co-watch usefulness remains unproven until the controlled evaluation in feat-505.
Exposure and CTR are measurements, not a new ranking objective. Historical
telemetry gaps cannot be closed by a later healthy sample.

## Scope and evidence

| Ticket   | Review state                                                                                                          | Acceptance boundary                                                                                                                     |
| -------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| feat-387 | Implemented in [PR #2430](https://github.com/JesusFilm/forge/pull/2430); local shadow and database evidence reviewed  | Production corpus coverage and authenticated Admin reconciliation remain open; feat-505 separately gates usefulness and promotion       |
| feat-373 | Implemented in [PR #2431](https://github.com/JesusFilm/forge/pull/2431); local browser and database evidence reviewed | Production ingestion and authenticated Admin reconciliation remain open; anonymous surfaces truthfully lack server-issued served counts |
| feat-545 | Evidence reviewed in [PR #2428](https://github.com/JesusFilm/forge/pull/2428); CI passed                              | Retained source discrepancies and natural terminal-response joins remain open; no owner-accepted limitation                             |

The direct prerequisites of feat-387 and feat-373 were recorded complete at the
base revision. Reciprocal dependency links were checked. No dependency was added
between these two tickets. Feat-545 continues to block feat-372, feat-381 and
feat-447.

## Review findings

- A co-watch generation must identify all score-affecting inputs. Eligible
  singleton outcomes and deduplicated source revisions still affect population
  denominators and require retained lineage, even when they do not win a pair.
- Profile-conditioned anchors must use the canonical current-profile and source
  validity rules. Request/profile inspection must retain trace-access auditing.
- Projection bounds must cover total work and database scans, not only returned
  rows or per-session cardinality.
- Exposure counts must map each policy to its actual surface. Eligible CTR must
  distinguish selections with a prior eligible impression from unmatched clicks.
- Placement identity must distinguish identical items and positions in separate
  authored blocks. Replaying a repeated event must not increment repeat counts
  again.
- Fresh telemetry aggregates must retain their actual filters, time precision,
  units and missing joins. Matching a prior count does not prove that two query
  populations are identical.

The implementation owners addressed these findings. Co-watch additionally retains
full generation and feature-version evidence through shadow ranking, labels copied
live items as the observed baseline, and prevents a shadow result from promoting
the lane. Exposure review also required identity changes after card reordering,
byte-aware batching, stable replay receipts, reporting-window regressions, and an
explicit indication when the Admin breakdown reaches its row limit.

The parent measured the original exposure ingestion service against an isolated
local PostgreSQL fixture: a fresh 64-event batch performed 192 queries and took
417/264/371/307/302 ms across five runs. This excluded HTTP latency. The implementation
owner replaced per-event persistence with bulk insertion and one bounded receipt
lookup, retaining replay, conflict and natural-repeat semantics. The parent ran
the committed repair five times against the same isolated database: 160/37/24/23/27
ms, with all 64 facts accepted per run. Each batch emitted four Prisma query
events: `BEGIN`, `INSERT`, `COMMIT`, `SELECT`. The two table operations are constant
with batch size; transaction-control events explain the difference from the
implementation task's two-query metric. This small local comparison establishes
the query reduction, not a production latency guarantee.

Migration numbers were coordinated with the independent storage change in
[PR #2429](https://github.com/JesusFilm/forge/pull/2429): that PR owns 0100–0102,
feat-373 owns 0103, and feat-387 owns 0104. This numbering reservation does not
introduce a feature dependency or include the storage PR in this batch's review.

After that storage PR landed, its retention continuation protocol exposed one
additional integration issue: a full exposure-only expiry batch must set
`batchLimitReached`, even before the remaining backlog is overdue. Feat-373's
follow-up includes `expiredWatchExposures` in that condition and extends the
full-selection regression cases. It preserves the storage change's bounded
scheduler behavior and keeps newly expired exposure backlog moving.

The [generation-lineage learning](../solutions/logic-errors/cowatch-generation-denominator-lineage-20260928.md)
records the denominator-only source regression and its prevention test. Existing
repository guidance already makes the knowledge store discoverable; no global
instruction edits were needed.

## Verification and deployment

Feat-545 was reviewed and integrated locally at
`919cd0d68d09b47e2acf84c845e0bbdbb3d6492c`. The three-file documentation change
passed formatting, JSON/link validation, roadmap lane checks and Git whitespace
checks. GitHub reported 13 successful checks, including `ci-gate`, with ten
scope-dependent skips and no failures. The
[follow-up record](https://github.com/JesusFilm/forge/blob/919cd0d68d09b47e2acf84c845e0bbdbb3d6492c/docs/operations/recommendation-evidence-telemetry-followup-2026-09-28.md) and
[sanitized query aggregate](https://github.com/JesusFilm/forge/blob/919cd0d68d09b47e2acf84c845e0bbdbb3d6492c/docs/validation/evidence-acceptance-20260928/feat-545-bounded-recheck.json)
preserve the exact limitations. PR #2428 was squash-merged at
`b145cedc362c371e0b70109a790f1ceb5bd3a2ea` on September 28 at 01:33:19 UTC.
The ticket remains `in-progress`; this is completed investigation work, not
completed acceptance.

The parent integrated both schema changes in an isolated branch. Merge conflicts
were limited to two curated test migration lists; resolutions retain all
applicable migrations, including `0100` through `0104`. All 105 migrations deployed successfully to a fresh disposable PostgreSQL
database. Regenerating the combined GraphQL schema and typed client produced no
additional drift. Admin, Web and typed-client typechecking passed. The combined-schema Admin typecheck
exposed excessive inference in the existing Prisma embedding guard; its narrowly
typed callback repair passed the combined Admin typecheck without changing
runtime behavior and is included in the co-watch PR.

The storage-baseline integration run passed 93 tests across eleven suites,
including co-watch projection, exposure reporting and ingestion, migration
lifecycle, playback episodes, profiles, retention service/scheduler/workflow,
shadow evaluation and compact/legacy delivery persistence. The focused exposure
retention repair passed its 47 service, scheduler and workflow tests in the
implementation task. Five Prisma helper/cache tests passed separately. The
parent's final four focused Web suites passed all 82 tests. The earlier combined
run passed all 14 tests. New standalone co-watch and exposure
database suites were run locally: the available GitHub token cannot publish
workflow changes. Existing curated CI fixture lists were updated, but these new
standalone suites are not yet explicitly selected by CI. This is a validation
coverage limitation, not a failed database test.

Co-watch's full Admin suite passed with 7,383 tests, 344 skips and one todo before
the final fixture repairs; GitHub subsequently passed its full Admin test job,
schema/database job, lint, build, formatting and `ci-gate`. Synthetic projection
of 50,000 sources and 25,000 pairs took 409 ms and 73 MiB heap in the implementation
task. These figures do not establish production coverage or latency. No
authenticated Admin browser session or production corpus was available.

Exposure's sequential full Web run passed 4,545 tests with ten skips and one
todo. Its real-browser check used the actual exposure boundary in a temporary
70-card development fixture with mocked POST responses. It exercised scrolling,
repeated intersections, selection before eligibility, hidden-tab dwell and
supported occlusion tracking. Three warm loading samples showed no observed
regression: without instrumentation, DCL was 198/181/132 ms and FCP 220/204/168 ms;
with instrumentation, DCL was 153/156/136 ms and FCP 172/180/148 ms. This small,
noisy fixture comparison does not verify production delivery or every Watch
player/page. The implementation's evidence document preserves those limits.

An expired fixed-date hybrid benchmark was repaired to use the current clock,
matching database-created timestamps. A separate owner handles the unrelated
Expo patch drift in [PR #2432](https://github.com/JesusFilm/forge/pull/2432).
Neither baseline repair changes recommendation ranking behavior.

Initial reviewed feature commits are `c255b6e439b1cd80ae2e22a3b7994bcb5adb30f4`
for feat-387, `b6e8769d876ca25ea7784df6efcec6047c21ceae` for feat-373,
and `919cd0d68d09b47e2acf84c845e0bbdbb3d6492c` for feat-545. The subsequent
storage-base refresh retains both schemas and the exposure retention fix above. The
linked PR check panels are the authority for their current CI and merge state.
The parent roadmap index was regenerated with UTC date normalization from the
integrated ticket states; it also picks up already-landed Auth, Mobile and storage tickets
missing from the previous generated index. Dependency links remain unchanged and
bidirectional.

All three tickets remain `in-progress`. Their implementation and evidence PRs
were merged through the normal PR-to-main flow below. No production flags,
pilot scope, experiments or candidate lanes were changed. Authorized Admin
reconciliation and representative shadow evidence are still required after
deployment; local synthetic evidence cannot close those gates.

## Merge verification

The parent checked the current PR heads, all check results, repository merge
rules and review threads. No review threads were unresolved. The repository
requires squash merges and no additional reviewer approval. Each merge pinned
the reviewed head with `--match-head-commit`.

| PR                                                    | Scope              | Squash commit                              | Merged at (UTC, September 28) |
| ----------------------------------------------------- | ------------------ | ------------------------------------------ | ----------------------------- |
| [#2428](https://github.com/JesusFilm/forge/pull/2428) | Telemetry evidence | `b145cedc362c371e0b70109a790f1ceb5bd3a2ea` | 01:33:19                      |
| [#2431](https://github.com/JesusFilm/forge/pull/2431) | Watch exposure     | `c7b8958d6f22a650e4ca9f75bc0f96e559a27bff` | 01:33:33                      |
| [#2430](https://github.com/JesusFilm/forge/pull/2430) | Co-watch shadow    | `8ddd29c5b66ca78e4bc9a24a18dd5b67d5601627` | 01:47:16                      |

Exposure's full post-merge `forge-ci` run passed. Before merging co-watch, its
owner refreshed the branch against the exposure merge, retained migrations
0100–0104 in the affected fixtures, and aligned profile-projection and
viewing-mode fixtures with the same list. Admin typechecking, schema generation
without drift, all 105 migrations on a fresh database, 26 focused unit tests,
30 PostgreSQL tests and normal lint/format hooks passed. The refreshed PR head
`678c6db2eeee5873a7164652f44425f887b05639` then passed all 17 applicable GitHub
checks. Runtime recommendation code matches the previously validated combined
integration; the additional changes extend the database fixture lists.

Railway's automatic deployment status exposed a separate staging Auth failure.
Environment `3c508519-e1d5-430a-be27-64477f9594e9` is `stage`, not production.
Deployment `b3f9cfc1-9647-4983-b483-6664a7c26431` built successfully, started
Next.js, then failed repeated `/api/health` checks with HTTP 503. Four earlier
deployments before this batch also had `FAILED` status. Production
`https://auth.jesusfilm.org/api/health` returned HTTP 200 with `ok: true` during
this review. The bounded logs do not establish the underlying staging cause.
[Feat-561](../roadmap/platform/feat-561-auth-staging-health-recovery.md) tracks
that separate follow-up; no deployment settings, environment variables or
manual redeploys were changed during the investigation.

These merge receipts do not establish completed feature acceptance, successful
deployment of every service, production exposure reconciliation, or a published
co-watch shadow generation. The remaining evidence gates above still apply.
