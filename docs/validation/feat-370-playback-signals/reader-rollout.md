# Feat-370 reader-first rollout

This phase expands the Admin GraphQL intake and Web playback API to accept
`playback-observations-v1` and `playback-observations-v2`. V2 adds optional,
bounded navigation and QoE facts plus coarse device and network classes; the
browser collector still emits v1 until the dependent emitter PR is deployed.
Both readers must be live and verified before that PR merges. Keep the
expanded readers in place while any v2 browser tab may remain open.

The Admin episode detail recomputes navigation and QoE projections separately
from retained immutable facts. The overview shows a full 24-hour, 7-day or
29-day **daily snapshot** beside the latest-20 diagnostic sample. Each
snapshot labels its exact rolling start/end, computation time, staleness after
48 hours, and the latest refresh failure. It is never silently presented as
live headline counts. The aggregate counts attempts, starts, finalized
episodes, current active-proxy outcomes, each family's observed/partial/missing
coverage, and bounded cohorts. Coarse device/network breakdowns suppress
groups below five episodes. V1 context remains unknown and is never backfilled.

The existing durable daily control-readiness workflow refreshes each preset
independently with a 30-second SQL statement and 35-second transaction budget.
A separate durable startup bootstrap queues missing/stale snapshot refreshes
and the new playback-signal readiness evaluation after a normal worker deploy,
even if the old daily loop survives the upgrade. Bootstrap queue failure does
not block unrelated worker startup. A failed preset retains its last successful
payload with a visible failure marker; a newer success cannot be overwritten by
an older job or failure. At most three identity-free snapshot rows exist, one
per preset, replaced on success. There is no historical snapshot archive.
The Admin query does not scan facts on page load. No user, session, episode,
profile, media or request identifier is stored in the snapshot.

Daily mature seven-day readiness evaluations scan their distinct historical
window once, then write separate append-only, identity-free revisions for
navigation and QoE. The v2 collector cannot be qualified from v1 history:
fewer than 100 v2 summaries remain inconclusive. Only v2-reconciled episodes
count as observed for the policy. An evaluation can authorize shadow
evaluation only and has `rankingInfluence=false`; no new raw signal enters live
ranking. The readiness ledger contains no user, session, episode, profile,
media or request identifier and is retained indefinitely as aggregate decision
history. Raw facts keep existing episode-bound 29-day expiry and purge/deletion
behavior. Admin Recommendations access stays authorized; no new profile link
is created.

The full-window SQL aggregates facts once per episode before looking up the
latest active-proxy outcome. On a local same-index synthetic corpus of 100,000
retained episodes, 1.6 million facts and 100,000 outcome revisions, a direct
request read took 4.41 seconds with JIT disabled. That exceeds the former
2.5-second Admin request budget and motivates durable background snapshots.
A smaller 50,000-episode/350,000-fact corpus took 1.65 seconds after the SQL
rewrite, versus 4.11 seconds for the initial lateral-summary query. These
local warm-cache timings are scale checks, not production latency proof.
A failed background refresh leaves the prior dated snapshot and independent
persisted readiness visible; playback remains available.

The collector and player retain their existing baseline facts and fail-open
behavior. The old v1 reader remains compatible. A v2 rollback must stop the
emitter while the expanded readers stay deployed until no old v2 tabs can
submit. Production verification requires the normal PR-to-main deployment,
Admin and Web reader version checks, a healthy Admin worker/bootstrap ledger,
and authorized Admin overview/episode inspection; no post-rollout production
observation is claimed here.
