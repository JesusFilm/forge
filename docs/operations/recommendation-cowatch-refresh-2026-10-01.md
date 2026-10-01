# Co-watch restoration and bounded refresh

The explicit no-study owner decision in feat-565 remains in force. This release
does not create a study, claim measured usefulness, revive G4/G5/G6, or relax
privacy, deletion, source integrity or expiry. Initial investigation and subsequent
receipts live in `docs/validation/cowatch-restoration-20261001/`.

## Mechanisms

- Playback receipt reuse recognizes the exact historical digest format without
  `directInfluenceAllowed`, only when current influence is allowed and every
  existing non-measure guard matches. Other changes continue to revoke.
- Co-watch hydration selects a usable theme from an exact active transcript
  contract. MMR may recover labels from an eligible nomination of the same exact
  video/playback/locale/audio while retaining the selected presentation. Truly
  missing metadata continues to fall back.
- Source hydration preaggregates retained ownership and preferred identities by
  session/episode instead of multiplying every raw row by every retained receipt.
  Exact-row/graph equivalence and a 60-generation owned stress fixture preserve
  semantics and the five-second read budget. Transaction-local JIT is disabled
  only for bounded preflight/publication transactions.
- `RecommendationCowatchRefreshService` uses an explicit recent-auth human-owner
  grant tied to the active direct release, exact manifest/configuration and owner
  influence floor. The worker records that grant in activation audit instead of
  impersonating a fresh human approval. Migration 0126 creates empty tables; it
  authorizes no production work.
- Policy `cowatch-refresh-seven-day-mature-v1` selects a complete seven-day event
  window ending seven hours before the UTC-hour evaluation cutoff. Check every
  five minutes; new attempts/publications are spaced at least 12 hours apart.
  Authority lasts 29 days. Source ceilings remain 50,000 raw rows, 256 per session
  and 250,000 attempted pairs. Refusal never shrinks the window.
- Attempts retain one UUID, source scope and expected pointer generation across
  lease recovery and uncertain acknowledgements. Publication and activation
  recheck the exact lease, grant and pointer under locks. A stop/floor change
  fences in-flight work; identical publication cannot renew graph age.
- Grant/attempt audit has no raw-source foreign keys and retains minimized
  terminal metadata for 2,555 days. The ordinary retention worker deletes only
  old terminal attempts and unreferenced grants after that period.

## Admission and activation procedure

1. Confirm the PR is merged and normal Railway autodeploy has the same intended
   SHA on Admin HTTP and worker. Inspect migration 0126 and generated workflow
   registration. Never use a manual redeploy to publish this checkout.
2. Declare the whole source window and cutoff before reading. Run the deployed
   `cowatch:shadow:rebuild` CLI with `--window-start`, `--window-end`,
   `--evaluation-as-of`. Its default mode is read-only preflight. Preserve the
   five-second statement, one-second lock and 30-second transaction limits.
3. Record raw/eligible sources, pairs, contributions, edges, row JSON bytes and
   exact generation. Recheck actual graph allocation, database bytes, filesystem
   free bytes, resident WAL, replication slots, transactions/lock waiters and
   retention health. Estimate retained overlap from the full 29-day lifetime;
   credit no future purge or filesystem recovery.
4. Supply an exact generation/scope publication admission file to the deployed
   CLI with `--execute --admission-file <path>`. Measure heap/index/database/WAL
   and filesystem deltas after publication. Abort/refuse if the current reserve
   or workload bounds fail; do not edit eligibility or invalidation fields.
5. Use the canonical Admin recommendation page to prepare and activate that graph
   with recent owner authentication. Keep the original operation ID on uncertain
   acknowledgement and reconcile before retrying. Verify the immutable release
   and graph through the supported status path and bounded read-only evidence.
6. Authorize bounded refresh separately with a reviewed capacity JSON object:
   `publicationLimits`, `publicationReserveBytes`, `maxRetainedGraphBytes`,
   `maxRetainedGenerations`, `maxDatabaseBytes`. Graph count is at most 64; grant
   admission requires at least 60 generations of reserved overlap. This is an
   operational ceiling, not a continuous disk-space measurement. Keep explicit
   filesystem/WAL/transient safety headroom outside the database ceiling.
7. Inspect the recorded grant, scheduler heartbeat and due time. At the next due
   refresh, verify the original attempt, new graph, atomically replaced release
   and exact served provenance. Existing graph revocation remains immutable.

## Serving and rollback proof

Apply the October 2 owner
[delivery-health policy](../analytics-and-recommendation-policy.md#delivery-health-and-accepted-coverage).
Sparse graph coverage with a successful incumbent fallback is expected behavior.
Report zero observed co-watch cards honestly; that alone is not a delivery bug,
an unhealthy-service finding or a blocker on proceeding. Positive contributed
cards are required only to claim that co-watch actually supplied cards in a
sample, not to accept ordinary recommendation delivery. Investigate recorded
server errors, timeouts or reproduced contract failures separately.

Count real requests only after deployment/activation, with the exact owner release
ID, pointer generation, manifest/configuration, graph ID and actual executed
generators. Count co-watch-contributed cards separately from requests that merely
execute the bundle. Record composition failures and legitimate incumbent fallback;
an enabled pointer or success response is insufficient. Do not synthesize human
viewing evidence for this proof.

The refresh status page reports authority readiness, deadlines, last successful
attempt, refusal and stop state; it does not certify actual serving. A failed
refresh preserves the incumbent pointer and serves fallback if its graph becomes
unavailable. `Stop automatic refresh` cancels future/in-flight delegated work;
the current release retains its original deadline. The existing emergency stop
is independent and fences serving immediately. Re-enabling the emergency switch
does not silently revive an old refresh grant.

## Recorded execution and disposition

The following October 1 receipts describe that observation time, not the
currently active generation or runtime. Consult the supported status path for
present authority and refresh state.

PR #2529 merged as `63511a87ff949e36885488346edf7fafb7566c27` after all checks
passed. The existing CI workflow was unchanged at the owner's request; feat-591
tracks adding the locally passing PostgreSQL suites. Both Admin and its worker
autodeployed successfully, then normally advanced to
`58cf00928a083156414618988f42c02545b4b1e6` (PR #2527). Deployed manifest and
configuration digests match the reviewed release. Migration 0126 applied and
the refresh scheduler recorded a running heartbeat.

The complete source window is September 23 19:00 through September 30 19:00 UTC,
with October 1 02:00 UTC evaluation cutoff. Preflight found 40,490 raw rows,
6,768 eligible sources, 46,737 attempted pairs, 40,295 contributions and 9,006
edges (834 supported). Initial admission refused a changed fingerprint without
writing. A fresh preflight retained the same complete window and counts. The
runtime guard also stopped before publication during the deployment switchover.
The deployed CLI subsequently published graph
`b5a47a2824cdf8adb9af02ec4c128ad80f430336199871313cfb1461afc89a8f`
at October 1 02:56:54.108 UTC.

After normal SSO reauthentication, the supported owner UI activated release
`be1947f1-3302-4a26-9b40-beb53d06a5f9` as **G7** at 02:57:35.266 UTC.
Its policy deadline is October 2 02:56:54.108 UTC; earliest dependency expiry
is October 22 19:00:18.809 UTC. G4/G5/G6 remain revoked. G6's original
`eligibility_changed` revocation and graph invalidation remain September 30
03:07:39.005 UTC.

Publication grew graph allocation by 57,769,984 bytes. Afterwards, filesystem
free space was 10,398,728,192 bytes and database allocation 38,220,142,271 bytes.
Grant `a593c39d-20c2-42fe-aefc-f6ce92776a4b`, recorded at 02:59:47.524 UTC,
expires October 30 02:59:47.524 UTC and anchors G7. Its reviewed budget reserves
96 MiB per publication, caps retained graphs at 6,300,000,000 bytes and 64
generations, and caps database bytes at 44,500,000,000. Full 29-day retained
overlap fits without crediting purge, with over 4.1 GB of presently observed
filesystem headroom outside the database ceiling. Explicit row/JSON-width
ceilings and calculations are in the capacity receipts. Other database growth
can make refresh refuse sooner; this is not continuous filesystem monitoring
or guaranteed availability.

The first automatic attempt was scheduled to become eligible at October 1 14:56:54.108 UTC
(October 2 03:56:54 NZDT), checked every five minutes. A ready grant is not
automatic refresh proof. The scheduled 24-hour follow-up will inspect the first
replacement, then switch to weekly review. Verify completed publication and
atomic replacement, retained capacity and truthful served provenance or expected
fallback before closing feat-573. Positive co-watch contribution is not a gate.

The initial natural window, October 1 02:58:00–03:06:14.516 UTC, contains 33
issued requests, 28 with cards and 163 cards. Exact owner execution and co-watch
contribution remain zero. One owner attempt correctly fell back for
`cowatch_supported_edges_sparse`; no missing-input fallback was observed.
This records valid activation and honest fallback without claiming positive
co-watch contribution or usefulness. The October 2 owner disposition accepts
this coverage; the separate refresh lifecycle verification remains open.

Sanitized receipts are under `docs/validation/cowatch-restoration-20261001/`.
Use `cowatch-serving-proof-indexed.sql` for later proof. Literal time bounds and
bounded per-request index lookups avoid global scans while preserving all exact
provenance predicates and five-second statement/one-second lock limits. The
original query timed out and returned no proof.

These detailed execution receipts are preserved in
[PR #2530](https://github.com/JesusFilm/forge/pull/2530).

The [October 2 disposition](../reports/2026-10-02-recommendation-coverage-acceptance.md)
accepts sparse-coverage fallbacks and allows the product to proceed. The initial
55-request sample's four sparse co-watch attempts all returned ordinary cards.
Actual refresh lifecycle/capacity verification under feat-573 remains a separate
operational task; lack of positive co-watch contribution does not establish a
delivery incident or reopen the repaired defects.
