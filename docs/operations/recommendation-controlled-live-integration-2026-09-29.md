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

## Reviewed production release and inactive authority

[PR #2470](https://github.com/JesusFilm/forge/pull/2470) merged through the
normal squash flow at `0a70712399bf99e10d88477b98cc34c8ababcc6b` on September 29
at 06:49:43 UTC. Exact reviewed head `637ffd96a4a34b1f9411feb83cf2fec7babcfb52`
passed the required checks with no unresolved review threads. Main's
[forge-ci run](https://github.com/JesusFilm/forge/actions/runs/36533138768)
also passed. `integration-release.json` retains the check and merge evidence.

The release check at 06:59 UTC observed Admin HTTP and the worker as sole
successful deployments on that exact merge, HTTP health 200, compact candidate
traces, and worker roles false/true respectively. Watch was still queued at that
observation; its final rollout and browser receipt are recorded separately.

A bounded read-only production check at 06:59:34–06:59:37 UTC verified the exact
0107–0110 migration checksums, no unfinished migrations, eight new tables, 27
valid/ready indexes, 13 named constraints, six columns, 48 enabled triggers and
three exact static manifest definitions. All eight new authority tables were
empty. No activated study, new-policy experiment or graph trial authority was
present. Counts stop at one and prove emptiness only; they are not full population
counts. See `integration-migrations.json` and `integration-admin-deployment.json`
in `docs/validation/recommendation-live-20260929/`. Registry availability does
not constitute an approved trial or a changed default.

The initial PR CI failures were isolated-fixture defects: the retention lifecycle
fixture stopped before the new composition migrations, and the promotion fixture
excluded CI's loopback database name. Both were reproduced and repaired; eight
focused native cases and the loopback `postgres`-name case passed before the
final green run. CodeQL alert 117 was independently traced to the verified actor
identifier in a deterministic audit digest and dismissed as a documented false
positive; no credential hash or security rule was changed.

## Capacity disposition after implementation

The storage owner's 06:16–06:20 UTC observation found 10.191 GB available, with
8.44–11.70 days to exhaustion at comparable recent positive growth before new
work. A single row-envelope graph would retain another 1.576 GB, before temporary
work, WAL and study costs. No loaded retention cycle was yet proven. The owner
supported this inactive code/migration release, but did not clear A/A enrollment,
graph publication or the proposed 500-request/200-minimum shadow evaluation.
See `production-capacity-decision.json`.

The shared-worker preflight was not admitted: a database timeout cannot bound
synchronous JavaScript heap and runtime in that worker. A reviewed isolated local
replacement uses one CPU, a hard 1 GiB memory limit with no swap, a 512 MiB V8
old-space setting, 128 PIDs and an independent 45-second cleanup deadline. Its fixture proof
verified both normal cleanup and forced timeout cleanup. The original read-only
transaction and population bounds remain unchanged. The owner's conditional
admission applies to exactly one invocation after fresh database/disk checks,
with source window September 22–29 UTC and evaluation cutoff September 29 at
06:15 UTC. It supplies no publication or trial authority; a refusal cannot be
retried with a smaller population. See `isolated-preflight-capacity-review.json`
and `local-isolated-preflight-runner.json`.

A/A admission is a deterministic fraction, not a hard assignment or request cap.
`plannedAssignmentsPerArm=200` is an evaluation minimum. Pricing only admitted
requests would omit discovery/profile reads on otherwise routable requests, shared
study accounting writes, repeat requests, exposure storage and bulk stop/expiry
work. The smallest legal 0.02% fraction is not a useful default proposal: even
treating the historical 8,420 candidate runs/day as distinct eligible profiles
would yield only about 1.7 assignments per arm over two days. Actual current
cohort and repeat-visit rates, full retained/index/WAL costs and transient/rollback
costs remain unmeasured. No study dates or fraction have been activated. The independently reviewed
`incumbent-aa-budget-proposal.md` in the validation directory retains an inactive
illustrative protocol, workload ledger and one proposed aggregate query for
future storage-owner review; that additional query has not been executed.

The first two loaded retention cycles, expected September 30 and October 1 at
10:30 UTC, remain the storage workstream's observation gate. A/A needs at least
two complete UTC enrollment days, at least 200 profiles per arm and each profile's
24-hour follow-up plus six hours for facts. Natural evidence cannot be replaced
with the local synthetic lifecycle proof. Feat-387, feat-505 and feat-565 remain
in progress. The accepted D1–D9 historical limitations close feat-545 only;
feat-566 retains the future remediation commitment without an agreed delivery date.

## One isolated production preflight: terminal refusal

The fresh 07:00 UTC storage admission found no lock waiters or transactions older
than 30 seconds, 10.185 GB free and comparable positive-growth estimates of
9.65–11.95 days to exhaustion. It cleared only the previously reviewed isolated
read-only invocation. `isolated-preflight-admission.json` retains the scope.

That one invocation ran September 29 at 07:01:54–07:01:56 UTC against the fixed
September 22–29 source window and 06:15 evaluation cutoff. The container verified
one CPU, 1 GiB memory, zero swap, 128 PIDs, non-root execution and a 512 MiB Node
old-space limit. It exited with code 1 after 2.29 seconds without a usable
aggregate CLI result. No OOM or deadline kill occurred, and cleanup removed the
exact owned container. `production-cowatch-preflight.json` records the terminal
refusal and the pinned source revision.

This result supplies no source, pair or edge counts. It does not establish a
source overflow, a successful database connection, or successful population
inspection. Raw diagnostics were deliberately withheld and not retained, so the
underlying exit cause cannot be recovered from this receipt. The transport-level
`receipt_received` means a runner receipt arrived, not that preflight passed.
The reviewed command has no `--execute` path; no graph publication, evaluation,
experiment activation or retry was performed.

A subsequent attempt needs a reviewed way to retain a bounded, secret-free error
classification, resolution of its actual failure cause, and fresh narrow
admission for the unchanged declared population. Do not infer a ready population
or narrow the window to obtain one. Graph publication, shadow evaluation and
A/A enrollment remain uncleared. Feat-387 owns this unresolved preflight and its
production/Admin acceptance; feat-505/565 retain their later evidence gates.

## All services converged

At 07:09:33 UTC, Admin HTTP, its worker and Watch each had one successful active
deployment at `0a70712399bf99e10d88477b98cc34c8ababcc6b`; all three local health
requests returned HTTP 200. Admin retained compact traces and the expected
HTTP/worker roles. `integration-deployment.json` records this completed normal
autodeployment, superseding the earlier queued Watch observation. Both main CI
workflows passed. This completes code deployment only; the production trial
authorities remain inactive under the separately recorded evidence gates.

## Production browser and page-loading observations

The genuine headless Chromium client remained machine-excluded. The old browser
request retained `viewing-mode-v1` with no co-watch capability and received six
items from the new Admin. After Watch deployed, a natural request sent both
`viewing-mode-v1` and `cowatch-mmr-v1` and received HTTP 200 with six contextual
items. No durable human identity, enrollment or qualified trial was manufactured.
The allowlisted `watch-capability-before.json` and `watch-capability-after.json`
retain this compatibility observation without request bodies, tokens or viewer
identifiers. It does not prove execution of co-watch or MMR for a viewer.

All six after-release navigations across Watch home, JESUS and NUA returned HTTP
200 with the expected headings. Before/after samples use the same browser version
and measured 1280×577 inner viewport; the earlier collector's 1280×800 prose is
not the measured viewport. There were two samples per route with uncontrolled
network and mixed cache state, and the browser restarted after idle. Encoded
first-party scripts grew by 18 bytes on home and 87 bytes on each detail route,
with unchanged script counts.

The original comparison is retained, including slower results: median
DOM-content-loaded times were 1,093→1,077 ms on home, 574→1,146 ms on JESUS and
862→974 ms on NUA; largest-contentful-paint times were 1,452→2,794 ms,
422→1,256 ms and 1,168→1,126 ms respectively. A bounded additional diagnostic
collected two more navigations on each flagged route. Home LCP was 2,132/1,668 ms
and used image responses of different sizes with 731/541 ms fetch durations.
JESUS LCP was its heading at 748/628 ms, with TTFB 400/386 ms versus baseline
261/240 ms. Those observations expose network/content variation but do not
establish the cause of every difference or erase the slower samples.

The loading comparison and diagnostic receipts are in the validation directory.
This small observational check establishes neither a statistically reliable
performance pass nor a regression attributable to the integration. Keep production
latency as an explicit operational trial guardrail; no co-watch performance or
usefulness claim follows from a healthy page or a contextual machine response.
