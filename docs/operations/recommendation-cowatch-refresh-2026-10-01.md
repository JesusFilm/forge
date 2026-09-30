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

## Current execution status

Implementation is under validation. No replacement or production refresh grant
has been created by this restoration run yet. Release IDs, final revisions,
capacity admission and real serving/refresh evidence must be appended here before
feat-565/feat-573 can be called complete.
