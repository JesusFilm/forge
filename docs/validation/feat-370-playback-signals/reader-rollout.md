# Feat-370 reader-first rollout

This phase expands the Admin GraphQL intake and Web playback API to accept
`playback-observations-v1` and `playback-observations-v2`. V2 adds optional,
bounded navigation and QoE facts plus coarse device and network classes; the
browser collector still emits v1 until the dependent emitter PR is deployed.
Both readers must be live and verified before that PR merges. Keep the
expanded readers in place while any v2 browser tab may remain open.

The Admin episode detail recomputes navigation and QoE projections separately
from retained immutable facts. The overview adds a full selected 24-hour,
7-day, or 29-day aggregate beside the latest-20 diagnostic sample. The
aggregate counts attempts, starts, finalized episodes, current active-proxy
outcomes, observed/partial/missing coverage for each family, and bounded
cohorts. Coarse device/network breakdowns suppress groups below five episodes.
V1 context remains unknown and is never backfilled.

Daily mature seven-day readiness evaluations write separate append-only,
identity-free aggregate revisions per family. The v2 collector cannot be
qualified from v1 history: fewer than 100 v2 summaries remain inconclusive.
Only v2-reconciled episodes count as observed for the policy. An evaluation
can authorize shadow evaluation only and has `rankingInfluence=false`; no
new raw signal enters live ranking. The ledger contains no user, session,
episode, profile, media or request identifier and is retained indefinitely as
aggregate decision history. Raw facts keep existing episode-bound 29-day
expiry and purge/deletion behavior. Admin Recommendations access stays
authorized; no new profile link is created.

The full-window SQL aggregates facts once per episode before looking up the
latest active-proxy outcome. In a local PostgreSQL synthetic 29-day corpus of
50,000 retained episodes, 350,000 facts and 50,000 outcome revisions using
the existing episode/fact/outcome indexes, `EXPLAIN ANALYZE` took 1.65 seconds
with JIT disabled (versus 4.11 seconds for the initial lateral-summary query).
The Admin read has a 2.5-second statement limit and fails open to an explicit
unavailable panel. The independent daily readiness read has a four-second
statement limit per family; a timeout marks the workflow run failed and leaves
prior persisted decisions intact. These local warm-cache timings are not
production latency proof.

The collector and player retain their existing baseline facts and fail-open
behavior. The old v1 reader remains compatible. A v2 rollback must stop the
emitter while the expanded readers stay deployed until no old v2 tabs can
submit. Production verification requires the normal PR-to-main deploy and an
authorized Admin overview and episode inspection; no production observation
is claimed here.
