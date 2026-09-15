# Recommendation quality work — September 15, 2026

## Scope and ownership

The owner requested the recommendations follow-ups from the live profile audit,
excluding locale/source coverage. Immediate exits have unknown preference meaning.
All work uses isolated worktrees based on main `3cc4017af`; the original checkout
and its uncommitted reports/tickets remain untouched.

| Earlier recommendation ticket | Current source | Treatment                                                       |
| ----------------------------- | -------------- | --------------------------------------------------------------- |
| 369 playback episodes         | feat-369       | Already complete on main; preserve shipped implementation       |
| 477 For you                   | feat-488       | Renumbered and complete; retain existing lifecycle validation   |
| 478 repetition                | feat-503       | Renumber local draft to avoid main's analytics-documentation ID |
| 370 navigation / QoE          | feat-370       | Observation work; incomplete families remain visible            |
| 393 composition               | feat-393       | Shadow only; editorial and evaluation gates remain              |
| 472 usefulness                | feat-505       | Renumber local draft; prepare a runnable controlled evaluation  |
| Immediate exits               | feat-504       | Separate unknown-meaning observation, no inferred dislike       |

The separate active task “Explore source-free recommendations” owns feat-496
runtime/admission recovery. Task snapshots and worktree ownership were checked;
this work does not change Web admission workers, Redis/cache settings, homepage
publication, or production runtime flags.

## Recent playback history

The reader previously found playback through issued recommendation requests.
Direct/search/editorial episodes have no such request, although qualified outcomes
from them can train profiles. The new reader obtains at most 32 recent episodes
per authorized session independently of the 32 issued-request bound, then merges
observed starts with recommendation selection/serve evidence.

The existing seven-day window, maximum eight authorized sessions and final 24-video
bound remain. Cross-session reads still require a valid active profile and current
privacy generation. Pre-authorization, expired, conflicted, future and late start
evidence is excluded. Server receipt time defines start recency: client events can
be buffered before context issuance or carry the accepted clock skew. Attempts
without an observed start do not count as watched.
Both incomplete and completed playback can supply the existing soft recency
preference; this change does not redefine qualified viewing or completion.

The composer still excludes the current video, prefers fresh candidates and uses
recent videos only after fresh supply runs out. For you retains its separate
qualified/completed history policy. Its live reader inspects seven days of at most
32 finalized episodes per currently authorized session, returning 24 videos; it
does not reconstruct history from expired session links. A completion found in a
profile contribution is therefore not sufficient by itself to prove a history
filter defect. The audit's eight historical completion matches are not relabeled
as confirmed defects.

### Local verification

- Recommendation service suite: **439 passing**, 78 database cases intentionally
  skipped in that unit run. The focused real-PostgreSQL recent-context suite ran
  separately with **6 passing** cases; candidate composition's 12 cases also pass.
- Real-DB coverage includes direct, search and recommendation origins; unstarted
  attempts; invalid, expired and reset profile scope; pre-link history; expired,
  late, conflicted and future receipts; bounded request and episode windows;
  accepted buffered starts and client-clock differences.
- A 25-call local fixture benchmark with 10,000 unrelated episodes measured
  **1.94 ms median, 4.41 ms p95**, with a **1.21 ms** explained database execution.
  The actual reader query used `recommendation_episode_session_created_idx`.
  These are local fixture measurements, not production latency promises.
- The complete Prisma migration chain applied to a fresh disposable database,
  including `0096_recommendation_recent_episode_index`. Its concurrent index build
  keeps episode ingestion available. Admin TypeScript and focused lint pass.

Reproduce the database test using `RECOMMENDATION_DB_TEST=1` and a disposable local
`DATABASE_URL`, then run `pnpm --filter @forge/admin exec vitest run
src/services/recommendations/recent-context.db.test.ts`. The fixture creates and
drops a unique schema; the database must provide the pgvector extension.

## Deployment verification

No production mutations or deployments were performed for this implementation.
Use the normal reviewed PR-to-main path. After deployment, the owner should:

1. Confirm the session index exists and is valid, and that the deployed Admin
   revision contains this reader.
2. Compare fixed 24-hour windows of delivery latency/timeouts and card fill.
3. Re-run the bounded repeat diagnostic from
   `docs/reports/2026-09-15-profile-recommendations/repeat-sample.sql`, separating
   source-neutral starts, actual rejected-stage recency reasons, and permitted
   refill. Do not infer suppression from a movement reason alone.
4. Investigate reduced fill or materially increased retrieval latency; a normal
   revert can restore the reader while retaining the harmless additive index.
   Do not trigger direct Railway redeploys from local worktrees.

## Shadow composition

The versioned row composer is integrated as supplemental shadow evidence. It
preserves eligibility, deterministic refill and explicit editorial constraints,
and shows pre/post positions and missing inputs in authorized Admin request detail.
The live slate and existing candidate-evaluation decision remain unchanged.

See [the verification report](../validation/feat-393-slate-shadow/verification.md)
for real-database provenance checks, desktop/mobile screenshots, and synthetic
render measurements. The composer adds no client module or network dependency.
Feat-393 remains in progress until editorial/history inputs, calibration and a
terminal composition decision are available.

## Immediate departures and playback context

`playback-observations-v1` uses a ten-second diagnostic window from known intent
to retained route/page departure, preserving elapsed time separately from active
playback. Before-start, after-start, completion, errors, visibility interruptions
and missing evidence remain distinct. Preference interpretation is always
`unknown`; these observations do not change durable interests or click weights.

The additive observation summary records expected start, error, seek, navigation
and QoE evidence. Missing facts make the projection incomplete. The recorder keeps
ordinary playback event IDs and payloads unchanged and can retry those events
alone when an older Web or Admin rejects the optional observation kinds. It does
not use that fallback for authorization or binding refusals.

The authorized Admin playback detail and latest-20-episode sample expose the
observations. See [the playback verification report](../validation/feat-504-playback-observations/README.md)
for protocol, retention, independent family coverage, browser evidence and local
load measurements. Feat-370 remains in progress: intent/severity instrumentation,
device/network breakdowns and whole-window readiness decisions are still absent.

## Controlled usefulness evaluation

The offline evaluator and read-only readiness inventory are integrated. The
primary metric is qualified recommendation views per assigned eligible profile,
including profiles without exposure. It reports uncertainty by assignment unit
and blocks conclusions when data is immature, sparse, contaminated or unhealthy.

See [the evaluation procedure](recommendation-usefulness-evaluation-2026-09-15.md).
Profile-based routing and A/A validation still need implementation and verification
before enrollment. Feat-505 remains in progress; the observational CTR difference
in the live audit is not an experiment result.

## Review

The parent reviewed scope, project standards, privacy/retention boundaries,
agent-accessible evidence, query bounds and shadow behavior. Independent reviewers
examined repeat-history correctness, the evaluator and playback lifecycle/protocol
changes. Review fixes cover:

- Buffered/client-clock-skewed playback starts use accepted server receipts for
  recent-history ordering.
- Mixed-version rejection retries immutable baseline facts without extensions.
- React StrictMode setup replay does not finalize an unused episode.
- Pausing during buffering closes the buffering interval.
- Missing terminal or expected facts cannot become complete coverage or an
  inferred before-start/rapid departure.

The final playback and evaluator re-reviews found no remaining actionable defects
within the implemented scope. Open ticket gates above remain explicit; this is
not a production effectiveness or experiment-readiness approval.
