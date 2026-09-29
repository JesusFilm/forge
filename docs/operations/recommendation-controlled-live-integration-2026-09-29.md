# Controlled co-watch and MMR integration — September 29, 2026

This release connects the implemented co-watch source and source/interest/theme
MMR composer to a governed trial. Installing its manifests and operators does
not enroll viewers, approve a graph, or change the ordinary recommendation
default. Production observations and rollout receipts must be recorded separately.

## Exact execution contract

- The incumbent is `hybrid-profile-viewing-mode-v1`. Its A/A comparator is
  `hybrid-profile-viewing-mode-aa-v1`; both execute profile ranking and the
  applicable current viewing-mode policy. Semantic-only calibration cannot
  authorize replacing this incumbent.
- The challenger is `hybrid-profile-viewing-mode-cowatch-mmr-v1`. It combines
  semantic, profile and a single approved co-watch graph, then applies the
  separately qualified `source-interest-theme-mmr-v1` composer. Its result
  measures the bundle, not the isolated contribution of either change.
- The union contains at most 64 nominations: at most 36 semantic, 12 co-watch,
  and profile nominations within remaining capacity, interleaved in that order.
  Eligibility, current publication/playability, recent-history suppression and
  the six-position limit remain effective. No editorial/series/speaker support
  is inferred from the narrower MMR input contract.
- The complete request deadline remains 1,500 ms. Current study, graph,
  composition, manifest and viewer privacy authority are checked again at
  issuance. The live graph path uses indexed retained authority and bounded
  anchor reads; full source inspection belongs to operator-time qualification.
- A request-local source or composition failure retains the original assignment
  and serves its actual incumbent with `cowatch_mmr_incumbent_fallback` and an
  explicit fallback result. The unapproved union is discarded. Normal incumbent
  operational failures are also named and retain assignment denominators.
- Global study/graph/privacy revocation stops new enrollment. A request racing
  that revocation returns unavailable instead of issuing a stale assigned slate;
  ordinary requests outside the revoked study remain on their existing path.
  Retained assignments remain in intent-to-treat accounting, and an interrupted
  study cannot become positive usefulness evidence.

## Browser capability and deployment order

An already-open Watch tab can retain an older parser after a deployment. New
clients explicitly send `x-forge-recommendation-delivery-contract: cowatch-mmr-v1`;
Web forwards only that recognized value through the optional GraphQL
`clientDeliveryContract` argument. The existing viewing-mode disclosure header
continues to work independently. Missing or unknown capability cannot enroll a
new viewer in either incumbent A/A or the bundle trial.

Both studies freeze the same capability-at-enrollment cohort. An existing
assignment remains sticky when the viewer later uses an older tab: delivery
serves the real incumbent with `client_contract_unsupported`, preserves the arm
and denominator, and resumes the assigned challenger on a capable tab. No
issued co-watch item is relabeled to fool an older parser. Legacy protocols
remain inspectable but cannot supply calibration for the new cohort.

The optional Admin schema argument ships first in prerequisite [PR #2469](https://github.com/JesusFilm/forge/pull/2469), merged as `e5a78708d20cd1fe5b5ae400d4240abfccfe3f59`.
Verify Admin accepts it before releasing the Web caller and trial integration;
this avoids an unknown-argument failure if ordinary app deployments finish in
different orders. Activation still requires the separate production gates.

## Shadow population and separate approvals

The bundle freezes `stable-durable-en-request-hash-v1` before sampling. Eligible
requests are issued, English, have only English-audio served items, and resolve
to a current active durable privacy generation with a published, unexpired,
positive-interest durable projection. This predicate is applied before stable
request hashing. Anonymous, session-only and other-language requests are outside
this declared trial cohort. Failures within the sampled cohort remain failures;
a retry reuses its initial population instead of replacing failed members.
The immutable sampling receipt includes an empty cohort; deleted retained roots
cannot silently reduce the denominator of a later favorable terminal decision.
Terminal publication locks the graph, composition protocol and manifest before
checking the retained run count. A native regression deletes a sampled request
between the initial snapshot and this fence: the old guard incorrectly promotes,
whereas the current guard records an inconclusive result. Shadow generation also
requires a usable semantic/profile incumbent under the same reconstructed history
and viewing-mode policy as delivery; co-watch cannot hide an incumbent failure.

An evaluation requires an exact graph ID and a predeclared composition protocol
for the same immutable manifest. A favorable candidate decision is only readiness
for a controlled study. Composition requires its own terminal decision and
operator calibration against its real observations. Neither approval establishes
causal usefulness. Graph mismatch, missing context, source failure, expiry or
privacy invalidation cannot be hidden by a passing aggregate from other runs.

The controlled graph has one frozen source window, evaluation cutoff and
`trialValidUntil = enrollmentEnd + 30 hours`. A/A calibration must precede graph
publication, and ordinary graph shadow evidence must be fresh when it is qualified.
Every actual source dependency must outlive the trial horizon; retention is not
extended. Republish cannot renew authority. The first source invalidation is
latched permanently into trial authority and survives graph deletion.

## Privacy, concurrency and retention

Durable source lineage captures the privacy generation while a valid discovery
link exists. Link expiry alone does not erase retained ownership. Reset/deletion
suppresses retained owned episodes before cascades, including singleton and
reclassified evidence. Invalid owners cannot silently become anonymous sources.

Publication and issuance acquire roots in the shared order: profile, request
where applicable, graph, composition and study. Source invalidation and mature
evaluation publication serialize over their dependencies. An evaluation cannot
ignore a source change merely because its writer is outside the enrolled cohort.

Composition observations expire no later than their request/profile/graph
dependencies. Retention drains at most 500 observations and 50 protocols per
batch. Aggregate graph-authority tombstones expire at the original source
population's maximum expiry, purge at most 500 per batch, and appear in retention
backlog health. No new record authorizes extending raw telemetry retention.

Deletion phases reacquire the transaction advisory lock independently; no
coordinator holds a pool connection across phases. Requests drain in chunks of 50. Cascades prelock the selected roots' retained source aliases and authority
in shared order, with a 50,000-row bound per dependency family and a reread
before deletion. Each phase persists deletion counts with its mutation. Later
failure retains committed progress and cannot publish a success watermark;
uncertain commit acknowledgement cannot overwrite durable counts. The original
five-second work budget includes post-admission transaction limits. These
semantics do not claim an entire batch is one atomic transaction.

## Production sequence and remaining gates

1. Deploy reviewed code through PR-to-main and verify HTTP, worker, Watch and
   migrations. Static registry insertion is not activation.
2. Obtain fresh storage/retention/lock/job health from the storage owner. Freeze
   A/A protocol dates, outer admission fraction and guardrails before activation.
   Collect at least two complete UTC enrollment days and 200 assigned profiles
   per arm, then each profile's 24-hour follow-up plus six hours for facts.
3. Calibrate the efficacy sample and meaningful delta from actual A/A evidence.
   Freeze those values and exact control/challenger/fallback policies.
4. Preflight the fixed seven-complete-UTC-day graph population with its closed
   cutoff. Existing 50,000-source/256-per-session/250,000-pair limits apply.
   A refusal is not permission to shrink the window until it passes.
5. Before publication, obtain storage clearance for actual population counts,
   heap/index/WAL/temporary work, concurrency one, deadlines and retained horizon.
   The existing 128-source fixture is not a maximum-size capacity guarantee.
6. Publish and pin one graph. Prepare composition before the exact shadow
   evaluation; proposed production sampling is 500 requested/200 minimum runs
   over one closed request window. Retain both terminal decisions and real
   authenticated Admin reconciliation, including sparse/failure observations.
7. Activate only the exact qualified trial; collect mature outcomes and external
   operational evidence. Freeze no new efficacy cutoff based on interim results.

Free space below 5 GB or projected exhaustion within seven days stops advancement.
Credit neither a future purge nor deferred Datadog counters. The first two loaded
retention cycles remain a separate closeout gate owned by the storage workstream.

The frozen graph deliberately cannot become a permanent default after its trial
deadline. Permanent co-watch use also needs a separately reviewed refresh and
requalification policy plus mature evidence. Feat-387, feat-505 and feat-565 stay
open until their actual acceptance gates pass. Historical D1–D9 were accepted by
the owner with future remediation in feat-566; that decision supplies no fresh
health or promotion evidence.

## Verification record

Owned PostgreSQL fixtures exercise real graph publication, immutable graph
binding, cohort sampling, shadow claim/publication, independent composition
qualification, trial qualification, privacy invalidation and bounded retention.
Synthetic fixture retrieval and outcomes are not production calibration or
Workflow queue-transport proof. Final combined checks, release revisions and
production receipts are recorded with the release, not inferred from these tests.

The combined recommendation and operator unit run passed 873 tests across 101
files. Its 273 native-database cases were skipped by that unit-only invocation;
owned-fixture results are separate. The final cohort guard passed ten unit and
two native tests, and the migration chain through 0110 replayed successfully on
the isolated PostgreSQL fixture after the sampling-receipt immutability change.
The real activated-bundle delivery test also passes. It creates mature incumbent
A/A calibration with 200 assignments and 20 qualified outcomes per arm, publishes
a fresh graph, computes shadow/composition approvals through the services,
activates the exact efficacy study and calls the actual delivery adapter through
issuance. Catalog fallback retains assignment; source invalidation between
composition and persistence prevents issuance. The synthetic retrieval/signing
inputs remain fixture boundaries. Extracting the shared outcome fixture preserved
all eight existing native study lifecycle tests.

Complete cold/warm challenger requests took 307/196 ms on the isolated 2 CPU,
2 GiB PostgreSQL fixture, with both asserted below 1,500 ms. This is local elapsed
time, not production load or pool-contention evidence. The test exposed and
verified the repair of a real activation mismatch: terminal shadow decisions use
Prisma CUIDs, whereas the initial protocol parser required UUIDs. The protocol now
preserves their actual bounded identifiers. The final retention-concurrency regressions pass; exact-head CI and
deployment remain release checks.

The real compact serializer was measured with 64 varied synthetic candidates and
six positions. The incumbent produced 228,894 JSON bytes/326 stages; the bundle
produced 318,473 bytes/384 stages. Shared approval metadata is stored once in the
first composed observation, preserving both trace formats. Repeating it across
all source observations would have produced 523,110 bytes. These measurements
exercise normal-sized identifiers, not maximum-length input bounds.

On owned PostgreSQL 18.6 with pglz, 100 payload-only rows allocated 4,186,112
additional bytes for the incumbent and 6,258,688 for the bundle: approximately
1.50 times the incumbent payload allocation. The optimized payload's stored
column size was 58,530 bytes. This excludes full request/item/index/telemetry
cost and attributable WAL, and is not production capacity clearance. Receipts
are in `docs/validation/recommendation-live-20260929/local-trace-*.json`.

The Admin study panel's local optimized-build comparison used four warm
navigations per variant. Median DOM-content-loaded time was 171.6 ms without
the panel and 141.3 ms with it; both made zero initial study API requests.
This small local comparison found no regression and does not establish a
production speedup. Watch's pre-release browser baseline is retained separately.

The final retention review covered committed-count loss, retained source aliases, unique-root admission, evaluation and assignment cascades, emergency rollback and uncertain commit acknowledgement. All eight findings were repaired and independently re-reviewed. A one-connection fixture drained 1,000 simple request roots in 1,865 ms and a loaded profile in 462 ms; neither measurement proves the largest production purge. Query-plan summaries are retained separately.

## Maximum row-count storage fixture

The isolated PostgreSQL 18 row-envelope fixture retained all 50,000 source rows,
250,000 pair-contribution rows and 250,000 edge rows with the real migrations,
constraints, triggers and indexes. Graph tables and indexes consumed
1,575,542,784 bytes; supporting ledgers consumed 220,504,064 bytes. Graph loading
generated 2,373,196,400 WAL bytes and 328,817,856 cumulative temporary spill bytes.
Cumulative spill is not a simultaneous temporary-space requirement.

The 2 CPU/2 GiB fixture used one writer, unchanged 5-second statement, 1-second
lock and 30-second transaction limits, and multiple bounded batches. Graph
loading took 115.9 seconds; the entire measured workload took 146.4 seconds.
This is a row-envelope storage measurement with its declared synthetic row
widths, not proof that the actual publisher completes the maximum generation
inside one 30-second transaction. The cgroup recorded 2,409 memory-limit/reclaim
events and no OOM; application heap headroom remains unproven. The owned container
and named volume were removed. See `local-cowatch-envelope-storage.json` for exact
fixture cardinality, measurements and cleanup. Production clearance still depends
on the actual preregistered population, available space and workload deadline.

The integration was reconciled with main `545a4de29` and independently reviewed.
The final optimized Admin build, workflow registration, Web/shared-client typechecks
and schema regeneration pass. The affected post-merge unit run passed 108 tests
with 58 native cases skipped. Concurrent roadmap IDs were reconciled without
changing scope: the changelog permission ticket is now feat-570 and the people
preapproval ticket feat-571. Production deployment and trial evidence remain
separate from these release checks.
