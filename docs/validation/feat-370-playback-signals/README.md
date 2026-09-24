# Feat-370 playback navigation and QoE evidence

## Collection and interpretation

`playback-observations-v2` keeps the baseline attempt, start, seek, end and
error payloads unchanged. The optional fact family records only bounded
diagnostic facts. A `playback_observation` summary declares expected seek,
navigation and QoE counts, coarse device class, and coarse network class. The
browser sends `unknown` when UA Client Hints or Network Information are not
available; it never sends a user agent, IP address, connection identifier, or
raw network metrics. V1 summaries remain readable with unknown context.

The Watch-next button and chapter navigation supply explicit manual-skip
intent. The player chrome supplies a user pause cause; Hero scroll-cover pause
supplies a scroll cause; an explicit modal-owned pause supplies a system cause. All
other native pause events retain an unknown cause. The first automatic start
supplies an autoplay transition. A 15-second timeout from known playback
intent is a QoE fact, including when the browser never emits `play`; it does
not terminate the episode or block the player. A media error is marked fatal
only for a decode or unsupported-source code; other error recoverability
stays unknown. Buffering followed by `playing` or pause records a closed
buffer interval; pause alone does not prove playback recovered. Native
seek-to-zero is not called replay: this
player has no explicit replay control, so deliberate replay intent remains
unavailable. All facts remain excluded from live ranking.

The optional v2 facts preserve the existing mixed-version fallback: exact
schema-invalid responses from older Web/Admin drop optional facts and replay
unchanged baseline events with their stable IDs. Each family remains bounded
to 16 facts, the episode to 128, and the HTTP batch to 16. Missing optional
facts are missing or partial coverage, never evidence of no behavior.

## Admin reporting and readiness

The audited episode detail recomputes navigation and QoE separately from
retained facts with family-specific input digests. The Recommendations
overview has two scopes: a dated daily full-window snapshot for each 24-hour,
7-day and 29-day preset, and a clearly labeled latest-20 episode sample for
detailed departure classification. The snapshot labels its exact start/end,
computation time, stale state after 48 hours and latest refresh failure; it is
not presented as the live headline window. The background aggregate counts
attempts, starts, finalized episodes, active-proxy outcomes, each family's
observed / partial / missing coverage, and bounded action cohorts.
Device/network breakdowns are shown only for cohorts of at least five
episodes. Older V1 facts retain unknown device/network context and are not
backfilled.

A separate daily mature seven-day evaluation scans its window once and writes
one immutable revision per family in separate transactions. It is idempotent
for the same window and input digest. Fewer than 100
v2 summaries in the full window are inconclusive, including historical
v1-only windows. Once 100 v2 summaries exist, under 80% reconciled coverage
requires revision; zero reconciled episodes in a sample of at least 500 retires
the collector version; otherwise it is eligible **only for shadow evaluation**.
Only v2-reconciled episodes count as observed for this readiness policy;
reconciled v1 episodes count as legacy/partial. A history of v1 facts therefore
cannot make the new collector ready before v2 deployment.
Each record carries health, reason codes, a reevaluation condition, a fact
aggregate digest, and `rankingInfluence=false`. It cannot activate a ranking
strategy. Navigation and QoE are computed and displayed independently; one
family's missing evidence does not suppress the other. Prior data is never
silently made ready by this migration.

The new ledger stores aggregate counts and coarse cohorts only, with no user,
session, episode, profile, media, or request identifier. Its declared
retention is indefinite as an identity-free historical decision ledger; Admin
Recommendations access remains authorized. Raw facts retain the existing
episode-bound 29-day expiry and purge/deletion behavior. Projection reads
exclude expired roots/facts, and no new profile link is created. If ingestion,
snapshot refresh or the daily evaluation fails, playback remains available.
Admin shows the last dated successful snapshot with a refresh-failure marker
and the last persisted readiness decision with its window, or an explicit
unavailable/no-evaluation state. At most three identity-free snapshot rows
exist, one per preset, each replaced on success; there is no snapshot archive.
Rollback is a Web collector revert while Admin continues to read V1/V2 facts;
existing immutable evaluations remain inspectable and cannot turn on ranking.

The full-window SQL aggregates facts once per episode before looking up the
latest active-proxy outcome. A local same-index synthetic 100,000-episode,
1.6-million-fact direct read took 4.41 seconds with JIT disabled, above the
former 2.5-second page-read budget. The Admin panel therefore reads only the
small durable snapshot. Background refresh has a 30-second statement budget
per preset. The independent mature-seven-day readiness scan has a four-second
statement budget. A timeout marks that workflow run failed and leaves prior
persisted evidence intact for reevaluation. These local warm-cache timings are
a scale check, not production latency proof. See `reader-rollout.md` for the
reader deployment and bootstrap boundary.

## Verification

Focused tests cover the 15-second timeout with and without `play`, explicit
manual skip and pause cause, unknown error severity, v1/v2 contracts,
independent projection recomputation, and readiness policy boundaries. The
real PostgreSQL episode fixture applies migration 0099, reconciles the
full-window aggregate, and checks idempotent per-family persisted decisions.
Run affected Web/Admin tests, lint, type checks and roadmap lint before PR.
Production validation requires the normal PR-to-main deployment and an
authorized Admin overview/episode inspection; this document makes no
production observation claim.

## Local browser load check

Six paired Chrome runs used the existing playback-recovery browser fixture
with a synthetic player/API and real React recorder, comparing reader commit
`f587a7c84` with this emitter. The fixture bundle grew from 66,487 to 67,025
gzip bytes; median recorder mount was 28.0 versus 28.95 ms, median DOM content
loaded 28.25 versus 29.15 ms, and median load event 28.35 versus 29.35 ms.
Both variants loaded four initial resources. The raw runs are in
`recorder-load-results.json`. This bounded check found no material recorder
mount regression; it does not measure a full Watch page or production LCP.
