# Co-watch restoration: initial production investigation

Observed October 1, 2026 NZDT (September 30 UTC). These are successive read-only
snapshots before restoration, not a release-success record. No application data,
serving authority, deployment, or production setting changed during these probes.

## Deployed runtime and authority

[Deployment receipt](deployments-initial.json): Admin HTTP and Admin worker both
ran `99554c8b0759ca4d88d02a0d63bf518e0a89b4cf`; Watch ran
`2cada63166aabfa2d9214009c6515a4c7576e880`. Each had one successful active deployment.

[State receipt](initial-status.json) at 19:29:41 UTC confirms owner pointer G6,
exposure 10,000 bps and kill switch off. Release
`d43d554f-362f-4cb5-b9d3-69e8fcd78dc9` references graph
`ba4d332f88695f36230308de1ed88820bdb9ddb5d14f0f4c89b7fba56d9c91b7`.
Both were invalidated/revoked at **03:07:39.005 UTC** for `eligibility_changed`.
The pointer cannot override that revoked authority. G4 and G5 are also revoked;
their audit history remains intact.

The graph retains 6,680 sources, 35,632 contributions and 9,000 edges. Its
`controlled_evaluation_required_feat_505` shadow decision is not a new experiment
requirement: the separate owner-approved direct no-study release remains the
applicable authority contract.

## G6 invalidation: legacy digest format drift

The [bounded successor comparison](g6-successors.json) inspected all 6,680
retained captured sources, with no missing decisions or revision gaps. Twenty-three
captured decisions had consecutive successors. All successors retained the same
positive effective decision: state, reason set, scopes, weight, actor and source.
Twenty-two changed stored population measures; all 23 changed input digest.
Twelve successors are within 60 seconds of the first invalidation, eleven later.

[Reuse guard comparison](g6-reuse-blockers.json) found no changed expiry,
evidence watermark, source, actor or policy in the twelve near-transition pairs.
None had expired. All twelve changed concentration. Current outcome dependencies
still existed and were not superseded; retained replay receipts show no additions
between captured decision and successor or afterward. This alone would not prove
that the entire classification input was unchanged.

The [aggregate hash reconstruction](g6-digest-reconstruction-timing.json) closes
that gap for the earliest observed supersession. Exactly one successor has an
application timestamp in the preceding 60 seconds through the database invalidation
time: **03:07:38.994 UTC**, 11 milliseconds before invalidation. Its successor
SHA-256 exactly matches the current complete classification input with successor
measurements. Its captured SHA-256 exactly matches the same reconstructed input
with captured measurements and **only `directInfluenceAllowed` omitted**.
Including that field fails to match the captured digest. All other retained reuse
guards match. The field was added by owner-release integration PR #2478; the G6
measurement-reuse repair #2505 hashes the current format and therefore cannot
reuse such a legacy positive receipt.

Eight of the twelve near-transition captured hashes match that legacy format;
all twelve successor hashes match the current format. Four near-transition
captured hashes do not match either tested format and remain unexplained. We do
not classify every successor as harmless. Application `decided_at` is not commit
time, and no initiating SQL audit log was recovered. The exact earliest hash match,
11 ms ordering, unchanged guards and trigger implementation strongly support
legacy serialization drift as the earliest observed G6 invalidation mechanism.
The lineage trigger correctly revokes when its captured receipt is superseded;
clearing revocation or weakening the trigger would be the wrong repair.

The reconstruction runs inside the Admin container. Private source IDs, digests,
viewing data and raw query rows do not leave it. The committed
[g6-digest-reconstruction.py](g6-digest-reconstruction.py) contains the exact SQL
and reducer; do not execute its embedded private-row SQL through a raw-output
client. It emits aggregate hash-match counts only and pins the runtime revision.

## Separate theme input loss

[Current catalog receipt](theme-catalog-initial.json), not historical request
attribution: 613 eligible G6 edges yielded a deterministically ordered sample of
128 distinct targets, with a 129th-target sentinel. All 128 were currently playable
for `en`/`english` under the exact current published locale/dub contract.

- 86 targets had usable labels on the first active-contract transcript chunk.
- 3 had no usable labels on the first chunk but did on a later matching chunk.
- 38 had complete matching-chunk populations with no usable labels.
- 1 had no matching active-contract chunk.

The sample inspected 195 chunks, with no per-target chunk cap reached. It proves
the first-chunk selection can discard valid later metadata. It also documents
real current metadata gaps that must continue to fall back. It does not establish
which cause applied to each historical missing-theme request.

## Actual serving and storage

[Serving receipt](serving-initial.json) for September 29 19:30 UTC through
September 30 19:30 UTC contains 5,938 requests, 4,993 requests with cards and
28,696 cards. It contains **zero exact owner-release executions and zero co-watch
contributed cards**. Fifty-three fallbacks report required composition inputs
unavailable; all 37 with retained detailed diagnostics flag only `missingTheme`.
These statements use exact durable provenance, not the configured pointer.

[Capacity receipt](capacity-initial.json) at 19:31:37 UTC found 10,746,630,144 bytes
available on the 48,891,670,528-byte database filesystem (79% used), 134,217,728
resident WAL bytes, no replication slots, no lock waiters and no transactions
older than 30 seconds. The three retained graph generations occupy 158,179,328
allocated bytes. Latest recorded retention success was 10:40:30 UTC; the oldest
currently expired request was 10:40:46 UTC. This is fresh headroom evidence, not
a future-capacity or retention certification, and credits no future cleanup.

## Fresh supported preflight and performance blocker

Declared before reading: `episode-event-window-v1`, window September 23 12:00 UTC
through September 30 12:00 UTC; evaluation cutoff September 30 19:00 UTC. This
implements the proposed seven-day event window with seven-hour maturation lag.
The [supported deployed CLI attempt](fresh-preflight.json) pins runtime and all
source hashes and supplies only `--window-start`, `--window-end` and
`--evaluation-as-of`. The CLI defaults to read-only preflight; it has no
`--preflight` flag. No `--execute` or admission file was supplied.

The attempt safely refused with SQLSTATE 57014 at the unchanged five-second
statement timeout, before producing population/graph counts. Its unchanged
repeatable-read transaction, one-second lock limit, 30-second transaction bound,
45-second child deadline and 512 MiB child heap were preserved. No automatic
retry was made. Graph sizing and publication are not justified by this refusal.

A separate exact [canonical population count](preflight-raw-population.json)
passed the same five-second statement cap with **40,605 raw canonical rows**,
below the 50,000 bound. The timeout is in the single source SQL read, before
in-memory graph construction. [EXPLAIN without ANALYZE](preflight-source-explain.json)
shows a global parallel sequential scan of the playback-fact table for the
late-fact anti-check, plus an estimate of only 756 canonical rows versus the
observed 40,605. The fact table had about 1.92 million live rows and 906.6 MB heap
at [metadata inspection](preflight-index-metadata.json). Existing episode/sequence
and episode/event indexes are available; no late-only partial index exists.
Other retained-owner, eligibility and supersession paths use relevant indexes.
This plan identifies avoidable work but does not independently apportion elapsed
time between all source-query operators.

The [OFFSET 0 comparison plan](preflight-source-offset-explain.json) replaces the
global late-fact scan with an episode-correlated bitmap seek through
`recommendation_fact_episode_sequence_key`. Its single authorized
[comparative aggregate read](preflight-source-offset-read.json) nevertheless
refused at the same five-second statement timeout, returning no aggregate rows.
This rules out claiming that the late-fact plan change alone fixes the complete
source workload; repeated retained-ownership hydration still needs investigation.

## Source query repair and exact production comparison

The first source-query repair retained the canonical latest-revision population and ordered
50,001-row overflow sentinel before hydration, resolves retained receipts once,
and joins session/exact-episode matches as sets. Linked identity still wins over
retained exact-episode and same-session recovery; invalid known ownership still
blocks anonymous fallback. No qualified/denied raw rows are removed. A zero-offset
late-fact subquery keeps the check correlated to the existing episode index.
Both preflight and publisher set `jit = off` only inside their existing transaction;
all statement, lock, transaction, population and pair limits remain unchanged.
This follows existing recommendation reconciliation/readiness conventions.

A bounded hydration-only analysis completed in 691.68 ms, with 40,605 canonical
rows, 3,102 retained receipts, 153,705 match rows, 2,843 retained identities and
1,298 linked identities. The full optimized query with JIT enabled still exceeded
five seconds. [Disabling JIT locally](candidate-source-nojit-preflight.json)
completed the source read in 2,339.7 ms and graph preparation in 2,538.0 ms total.
The [original query with JIT disabled](original-source-nojit-preflight.json)
completed in 4,860.1 ms, leaving much less headroom.

The first [same-snapshot comparison](source-same-snapshot-comparison.json) ran
both queries serially in one read-only repeatable-read transaction, with a separate
unchanged five-second cap on each statement. At 20:01:44 UTC it found **40,605 rows
in each result, zero changed rows or fields, identical ordering, and identical
graph generation** `60d5a5502cafce2e094dc496ab17ac571ed8b1ce3e42ae48d09a09e6652256b3`.
The original source read took 4,922.5 ms; the optimized read took 2,290.5 ms.
Graph hashes from earlier separate snapshots differ because current state changed;
the same-snapshot result establishes equivalence for the observed population.
No production graph was published by this comparison.

Fresh aggregate sizing from the successful candidate preflight:

| Measure                               |         Observed |
| ------------------------------------- | ---------------: |
| Raw canonical sources                 |           40,605 |
| Eligible sources                      |            6,841 |
| Attempted pairs                       |           46,663 |
| Contributions                         |           39,961 |
| Edges / supported edges               |      9,123 / 844 |
| Publication rows                      |           55,926 |
| Source JSON bytes / maximum row       |  5,596,867 / 863 |
| Contribution JSON bytes / maximum row | 20,929,103 / 541 |
| Edge JSON bytes / maximum row         |  4,453,321 / 507 |

These are serialized input widths, not physical heap/index/WAL/temp bounds.
Retained session matches grow with overlap and session density, so later admission
still needs fresh physical capacity and resource checks. The successful read does
not freeze sources for a later publication.

The owned native fixture compares every returned field and full built graph with
the frozen original SQL across thirteen source cases, direct-link priority, and a
later privacy-generation change. All 59 focused native/CLI/graph/projection tests
and scoped lint passed; [validation details](source-query-validation.json).

## Retained-generation overlap and final grouped query

The independent [overlap fixture](retained-overlap-proof.json) found that the
first repair still multiplied raw episodes by retained session receipts. Three
generations passed at 2,054 ms, but sixty generations produced 3,102,000 match
rows and refused at the unchanged five-second limit. This blocked that candidate.

The final [grouped SQL](preflight-source-grouped-explain.sql) reduces invalid and
known ownership separately by session and episode, and chooses each group's best
valid retained identity before joining raw episodes. Current links still win over
exact-episode retained identity, which wins over session retained identity. Either
invalid ownership group blocks influence; known ownership without a usable identity
cannot fall through to anonymous. The canonical population, overflow sentinel,
eligibility, expiry, suppression, watermark, late-fact and supersession checks
remain unchanged.

The independent fixture now passes at **2,054 ms for three generations and
2,331 ms for sixty**, with identical complete ordered row digests across the
original three-generation, grouped three-generation and grouped sixty-generation
results. This includes 40,605 raw rows, 6,841 qualified rows and 62,040 retained
profile-backed receipts at sixty generations. It is a synthetic overlap workload;
it does not prove every possible future session distribution or publication cost.

The final [production comparison](source-grouped-current-runtime-comparison.json)
at 20:16:37 UTC used one read-only repeatable-read transaction with explicit
five-second statement and thirty-second transaction timeouts. The first repair
took 2,292.8 ms and the final grouped query took **2,686.7 ms**. Both returned
**40,605 rows, zero changed fields or rows, identical ordering and identical graph**
`16c18057501c5eae7961a35e89aafb0ee76fc7c50784eefca6768e5e83b1742b`.
The graph counts remained 6,841 sources, 46,663 attempted pairs, 39,961 contributions
and 9,123 edges. A preceding attempt stopped at its deployment-revision guard
before opening a database connection: normal deployment had advanced Admin from
`99554c8` to `3748973`. The [guard receipt](source-grouped-runtime-guard.json)
records the newly observed revision and unchanged graph-builder file hash; the
successful comparison pins both. The failed attempt and all earlier SQL/receipts
are preserved separately.

All **59 focused tests**, scoped lint, formatting and diff checks passed after the
final change. The native frozen-original oracle now covers sixty retained
generations, foreign-session exact-episode priority and invalid ownership,
shared-session invalid ownership, and legacy-only ownership with a null captured
generation both with and without a valid current link. It compares every raw field
and complete built graph in each phase; [final validation](source-grouped-query-validation.json).

## Reproduction constraints

The initial candidate, candidate with JIT disabled, and original-query control
were captured by helpers that accidentally shared an output filename. The original
control was preserved directly; the two candidate receipts were restored from
their captured tool responses and marked accordingly. No query was rerun to repair
the filenames. The reproduction helpers now require a new `--output` path and
refuse to overwrite an existing receipt before contacting production.

Adjacent `.sql`/`.json` pairs contain aggregate results in statement order.
`query-readonly.cjs` verifies Admin private/public database identity before
connecting, uses serial UTC read-only transactions and caps statement/lock time
at 25 seconds/2 seconds. Individual preflight comparisons reduce statements to
five seconds. `capacity-read.py` uses the verified Admin PostgreSQL service's
read-only psql connection and filesystem `df`; it performs no cleanup.
Credentials, viewer identifiers, raw viewing histories and vectors are absent
from exported receipts. Current-state results can change under retention or
subsequent traffic. This investigation alone does not demonstrate restored serving.
