---
id: "feat-590"
title: "Precomputed video recommendation experiment"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-10-05"
duration: 7
depends_on: []
blocks: []
tags:
  - "recommendations"
  - "admin"
  - "web"
  - "ai-pipeline"
  - "experiments"
---

## Problem

A known-usage rejected edge response stopped the run at 4,927 comparisons and
89 finalized sources. Add a single durably bounded retry after fresh receipt
verification, preserving all completed pages and original usage records.
See `docs/plans/2026-10-15-007-fix-known-rejected-edge-resume-plan.md`.

All seven interrupted batches recovered, then the full run reached 3,884
comparisons and 73 finalized sources. An uppercase source slug exposed a
source-only analytics mapping precondition that stops the entire catalog.
Preserve unknown analytics and coverage counts through the existing per-row
mapping checks while continuing content comparisons; retain frozen inputs.
See `docs/plans/2026-10-15-006-fix-unmapped-source-history-coverage-plan.md`.

The deployed recovery attempt exposed a producer guard still restricted to the
older two-source first page. Validate each executor recovery against its reviewed
source/page/rank bounds and preserve the current generation's lossless prompt
format. Add execution tests for all seven v6 shapes before resuming recovery.
Unaffected catalogue generation continues on the existing released producer.

The frozen resume saved three model receipts and 21 comparisons, reaching 2,930
comparisons and 42 finalized videos. A reservation then committed after 19.177s,
beyond the local 15s deadline but within Admin's 30s transaction allowance. Align
reservation waiting with the existing 60s freshness budget (45s wait, observations
at most 15s old before reserving). Audit the exact third no-dispatch reservation;
keep its original null usage and same-page continuation constraints. Release live
leases after a fully receipted protocol-4 attempt closes, preserving unresolved
leases and closed-attempt replay isolation, to avoid 20-minute gaps between clean
manual recoveries.

The frozen-catalog resume fix shipped through PR #2722. Recovery now extends the
existing operator path to the seven exact interrupted v6 calls. Preserve original
unknown usage, bind replacements to the same frozen pages, admit them serially,
and qualify each only after a saved receipt and closed replacement attempt.
Native proof covers two recoveries in one generation, immutable originals and
rejection of live leases, changed seals and reused replacement IDs.

October 15 continuation: metadata-only diagnostics confirmed provider rate-limit
errors at concurrency twelve. Add optional bounded spacing between new model
process starts, with fresh admission after waiting and no automatic retries.
All 1,031 profiles and 2,909 comparisons are saved; seven interrupted calls across
ten sources still require recovery. A later catalog sync also advanced observed
timestamps. Read-only revalidation found all profile keys, selected transcripts,
and candidate pools unchanged. The saved original catalog also matches the
sealed route digest. Add a hash-pinned local resume reader and generation-bound
Admin content revalidation, preserving strict discovery and changed-content
rejection. Native tests exercise a paused build through finalization after
timestamp-only sync and reject altered transcript text, metadata and eligibility.
Complete deployment and observe saved comparisons before claiming generation runs.

October 14 closeout: the owner requested a full-catalogue processing target below
eight hours. Add bounded local concurrency (1–16; default 1) for independent
profiles and source-pair batches, retain full profiles and the same Astra model,
and drain in-flight receipts before pause or failure closes an attempt. Measure
live throughput before claiming the target is achieved. Public activation
remains a separate decision.

The four-call production trial retained 21 successful calls with no failed or
unresolved receipts and measured 3.3 times the serial call throughput. The next
run reached twelve simultaneous reservations without request errors. Raise the
operator ceiling to sixteen to give the eight-hour target more headroom; the
model, quality settings, admission checks and graceful drain remain unchanged.

The sixteen-call run completed all 1,031 profiles. Concurrent edge reservations
then exposed Admin's generation lock: one admission took 18,147 ms, beyond the
local 15-second deadline. Serialize only reservation writes while keeping up to
sixteen model calls active. Migration 0151 extends the sealed no-dispatch
allowlist to that exact two-member reservation, preserving null provider usage,
original receipts and source checkpoints. Resume through the native operator
acknowledgement after normal deployment and expired leases; never replay the
original reservation or infer completed comparisons from it.

The queued run preserved 66 successful comparison calls before a two-source
batch shrank to one source and changed its historical-context digest. Keep the
first reservation's source membership when rebuilding analytics context across
pages and resumes, including a prior partner that is no longer active. Sources
with different frozen contexts run in separate batches. This uses the existing
imported capture and ledger membership; no database rewrite, new GA query,
profile shortening or model change is required.

The next run saved 81 comparison calls before one dispatched Astra process hit
the three-minute default deadline without a usage receipt. Allow up to the
existing five-minute maximum by default so slower replies can finish. Preserve
the unknown original call and its ten comparisons for explicit recovery;
unaffected sources can use the existing bounded-work interface. This timeout
change does not establish a completion ETA or reconcile the interrupted call.

The resumed run saved another 111 comparison calls before PostgreSQL exhausted
its shared-memory mount during the catalog-version proof. The broad catch
incorrectly labeled SQLSTATE 53100 as an invalid passage. Keep edge transactions
out of parallel query shared memory with a transaction-local worker limit, and
only translate catalog validation errors into passage rejection. The sixteen
model calls, full profiles, frozen input, and evidence checks remain unchanged.
The rejected reservation created no call row; all 111 admitted calls finished.

Explore whether a capable reasoning model can find useful connections across
the video catalog from transcripts, metadata, and historical analytics, with
recommendations computed periodically and stored in PostgreSQL before viewers
request them. Preserve the existing recommendation system while evaluating the
experiment and retain it as a rollback option.

## Entry Points — Read These First

1. `docs/brainstorms/2026-10-05-precomputed-video-recommendations-requirements.md`:
   agreed requirements, storage constraints, and remaining implementation inputs.
   The approved implementation spec is
   `docs/plans/2026-10-05-001-precomputed-video-recommendation-spec.md`; its ten
   published child tickets and issue graph are recorded in
   `docs/plans/2026-10-05-precomputed-video-recommendation-tickets/`.
   The executable handoff is
   `docs/plans/2026-10-05-precomputed-video-recommendation-orchestrator-prompt.md`.
2. `CONCEPTS.md`: Video, Dub, Video Edition, Language, Enriched Transcript Chunk,
   Precomputed Video Recommendation, and existing recommendation vocabulary.
3. `apps/admin/src/services/recommendations/delivery-retriever.ts`: current
   transcript-based candidate retrieval.
4. `apps/admin/src/services/recommendations/delivery.service.ts`: current
   semantic/hybrid serving, issuance, and fallback boundaries.
5. `apps/admin/prisma/schema.prisma`: `VideoTranscript`, `VideoTranscriptChunk`,
   `RecommendationStrategyManifest`, and experiment/evidence models.
6. `apps/web/src/lib/recommendations.ts`: current consumer operations.
7. `docs/roadmap/content-discovery/feat-473-production-recommendation-analytics-assessment.md`:
   historical analytics assessments and known measurement limitations.
8. `apps/mastra/src/services/google-analytics-client.ts` and
   `apps/mastra/src/services/google-auth-client.ts`: existing bounded GA4
   reporting and Google authentication patterns; not a warehouse adapter.
9. `docs/operations/recommendation-served-snapshot-format.md` and
   `docs/plans/2026-09-30-001-recommendation-storage-efficiency-plan.md`:
   merged compact storage contracts, newer than this checkout. Integrate with
   these formats; do not design against the old per-item payload layout.
10. `docs/solutions/best-practices/recommendation-trace-capacity-and-retention-proof-20260928.md`
    and `docs/solutions/performance-issues/recommendation-storage-recovery-metrics-20261002.md`:
    physical growth, loaded-retention proof, and allocation/recovery distinctions.
    See the requirements document for verified compression PR references and
    the separate outstanding `feat-554` retention-capacity work.

## Grep These

`getSemanticDeliveryCandidatePool`, `hybrid_personalized`,
`RecommendationStrategyManifest`, `RecommendationExperiment`,
`VideoTranscriptChunk`, `audioLanguageSlug`.

## What To Build

The user confirmed the design through the grill-with-docs workflow on October
5, 2026, then approved the testing boundaries and ten-ticket breakdown. The spec
is published as [#2565](https://github.com/JesusFilm/forge/issues/2565), with native
child/dependency relationships for #2566–#2575 verified against GitHub. The user
intentionally removed Sandcastle; implementation uses Codex chats directly and
runner-list verification is not applicable.
Do not repeat the shared-understanding confirmation. The duration remains a
provisional scheduling placeholder, not an implementation estimate.

The user authorized an orchestrator that creates GPT-6 Sol chats using Matt
Pocock's implement workflow. Compound Engineering skills are explicitly excluded,
including indirect invocation. This overrides the repository's default workflow
for this effort while preserving other standards. Astra remains the product's
generation model. [PR #2578](https://github.com/JesusFilm/forge/pull/2578)
was squash-merged on October 12, 2026 at 20:32:18 UTC to main commit
`9cdb2b74567c2a7f21cdb6d5b9a658236a52363e`. It integrates verified Admin
comparison, source generation, private Watch serving,
visit/click attribution and private durable CTR reporting. #2568's fixture and
source-qualification boundary is verified, and the programmatic GA report reader
has passed live read-only checks. The user approved referrer links plus engagement
as navigation evidence for the first build on October 6. Ingestion and current
catalog mapping are integrated and verified, including a live GA pair read and
Astra judgment through OpenRouter. #2569 resumable builds are integrated and
verified. #2574 storage and loaded cleanup code is now integrated and verified:
21 connected native cases, 63 focused Admin cases, 13 Mastra cases and seven
ordinary-retention cases passed, with migrations through `0136`. The 6,715-root
loaded fixture passed without equating reclaimed rows to recovered filesystem
space. #2575 manual controls and Watch consumption are integrated: 25 connected
native cases, migration `0137`, and desktop/mobile control checks passed. The final
Admin suite (9,019 tests), 42 additional native cases, typechecks and generated
contract checks passed. The subsequent signed final-calibration verifier is
integrated and passes 135 combined precomputed tests, 25 connected tests and
all 144 official migrations. Its independent source/key/method, agreed numeric
loss policy and actual live human/bot/loss evidence remain unconfigured. Full
catalog execution and production capacity also remain incomplete. The execution ledger is
`docs/plans/2026-10-05-precomputed-video-recommendation-status.md`. Public
experimental serving remains default-off.

Admin and Mastra are deployed; production migration verification passed with
19 migrations and 30 tables. The initial origin-capture attempts stopped safely
after six successful physical GA reads, zero pending reads and zero model calls,
without an artifact: the reader rejected the observed singleton leading
`DATA_TRUNCATION_TYPE_DATE_RANGE` prefix. The October 13 qualification fix retains
that exact raw range and original requested history, requalifies from August 11,
2022 after inclusive truncation through August 10, and rejects ambiguous ranges
or remaining usable-range limitations. Existing property-truncation behavior is
preserved; see `docs/operations/precomputed-catalog-build.md`.

The user authorized normal deployment, private configuration, bounded manual
catalog execution and a qualified baseline. Full catalog execution, baseline
qualification and public activation remain incomplete; public activation and
promotion are not authorized. Capture continuation remains manual after the
normal reviewed PR-to-main deployment. Keep `feat-590` in progress until its
acceptance gates are met.

Confirmed target: a separable catalog-wide recommendation experiment with an
initial historical-data build, persisted recommendation results, and later
integration on individual Watch video pages. The model chooses useful
relationship types per Video. Recommendations are shared, and each source may
have a different number of connections; storage must not inherit the current
six-card delivery limit. Catalog-wide discovery is required, exhaustive
pairwise model judgments are not. Retain every accepted connection while
initially displaying up to six in the existing layout. The model chooses
alternatives where direct connections are absent; do not silently replace that
decision with incumbent fallback.

Use `gpt-6-astra` initially. Compute in English, drawing on non-English
transcripts where needed, and filter saved choices to videos playable in the
selected audio language. Mark metadata-only judgments honestly. Let the model
weigh content and historical analytics while requiring explainable connections
and avoiding penalties for missing exposure. Provide an Admin comparison of
existing and experimental recommendations, including reasons and available
transcript evidence.

Precompute broader model-chosen alternatives. If neither direct choices nor
alternatives survive eligibility filtering, hide the row and flag the coverage
gap in Admin. Allow different chapters or parent films when they add viewing
value; exclude the source itself, duplicate copies, and alternate Dubs of the
same Video.

Compare the experiment against the existing system through an A/B test with
visit-level CTR as the deciding metric: eligible human Watch visits with a
recommendation click divided by all eligible human Watch visits, including
empty-result visits. Exclude bots from both counts and retain card CTR as a
secondary diagnostic. Require a predeclared stopping rule and support an
inconclusive result that keeps the incumbent.

On October 8 the owner selected reusable complete-content profiles and batched
Astra decisions through the locally signed-in Codex subscription. This replaces
the earlier unrestricted API-spend assumption for new build work. Preserve the
complete catalog, evidence and connection requirements; keep the personal login
outside Railway and pause on insufficient or unknown allowance without paid API
fallback. Report tokens, observable subscription usage and elapsed time; do not
derive a dollar bill from API rates or call an unknown charge zero. See the
[subscription build plan](../../plans/2026-10-08-precomputed-recommendation-subscription-build.md).
Every build, rebuild and paused-run resumption requires explicit manual action
and the initiating person's own locally signed-in Codex subscription. Do not
regenerate on a schedule, content/analytics change, deployment, startup or quota
reset, and do not route another operator's request through a shared owner's
login. Included allowance has no separate model API charge; subscription fees
and possible credit billing remain distinct from a claim of "$0 tokens."
Include the user's historical GA data, not just Admin's retained logs.
GA4 property `320198532` has an existing BigQuery link. Browser reads work in
`jfp-data-warehouse`, but verified copies contain only March–July 2023 totals
without usable video-start session keys. Service-account impersonation now
authenticates the remote GA Data API reader, which observes current and historical
Watch aggregates and explicitly reports source truncation. The first build uses
validated Watch referrer links plus engagement, labeled as navigation evidence,
under the October 6 user-approved revision. This does not prove consecutive
playback; strict ordered-history inputs retain their existing meaning. Current catalog
Video mapping is validated; historical URL ownership remains explicitly unverified.
A complete live catalog build and its cost/capacity report remain to be verified. Historical
recommendation evidence is limited to verified JesusFilm.org hosts and exact
`/watch` or `/watch/` descendant paths, as clarified on October 6, 2026.
The proposed design lets the model explore through authenticated read-only
tools; credentials remain in server configuration. Include warehouse-query
cost in the first-build report.

Use a 50/50 split with browser assignment fixed across the experiment. Freeze
the experimental generation during the first A/B test. Persist a versioned
winner/inconclusive report retrievable from Admin or an authenticated AI read
path. The user will ask another chat to activate the result manually; neither
build completion nor evaluation may activate serving. Creating or messaging
that other chat is outside this current request.

On a technical failure loading experimental recommendations, attempt the
incumbent and record the failure and actual delivered strategy. Keep the visit
in its originally assigned arm for primary analysis and report fallback rates
in Admin and the stored result. Valid empty results still hide the row; failed
background builds retain the previous complete generation.

Source discovery and the detailed measurement policy remain open. Extend the
existing card-render, impression, selection, and playback tracking with
experiment-linked eligible visits, including empty results, and exact
generation/arm attribution. Recommended first-build storage is the existing
Admin PostgreSQL ledger on Railway. Keep additional storage minimal and bounded,
reusing the merged compact traces, packed served snapshots, thin relational
identities, and existing evidence ledger. Store explanations/evidence once per
generation and reference them from deliveries. Preserve durable evaluation
results and the current 29-day raw retention with an explicit aggregation
design for longer tests. BigQuery export, export outboxes, warehouse write
access, and another analytics database are out of scope; the existing warehouse
remains a read-only historical input.

The existing experiment code implements limited A/A/hybrid admission and A/A
evidence policy; it does not already implement this CTR test.

## Constraints

- Preserve the existing recommendation system and its rollback availability.
- Precompute the experimental connections; do not put model inference in the
  viewer request path.
- Building experimental results does not activate public serving.
- Verify exact Astra access through the selected build backend. A successful
  synthetic subscription probe proves access and output compatibility only,
  not full-catalog quality, completeness or available allowance.
- Historical recommendation exposure is observational evidence, not proof of
  causal uplift or a complete record of viewer preferences.
- Follow existing Video/Dub/Language identities and Admin consumer boundaries.
- Bound retained generations, failed-run diagnostics, and evaluation history;
  preserve active/test/rollback requirements and every accepted connection in
  retained generations. Do not use six displayed cards as a storage quota.
- Measure physical bytes and growth against Railway volume headroom before
  enabling traffic. Subscription-backed inference does not authorize
  unrestricted database storage.
- Preserve immutable served evidence and raw retention; avoid duplicate telemetry,
  redundant indexes, and full transcript/model-prompt copies in visit records.
  Destructive reclamation of existing data is outside this feature.
- Keep unrelated existing workspace edits intact.

## Verification

October 13 production closeout: the qualified GA origin for 1,031 frozen sources
is sealed and independently verified (315,732 rows, 632 pages, 1,292 reconciled
successful physical GA calls). The first protocol-4 pilot stopped before import
or inference. A read-only reproduction measured 122,880 bytes of database growth
between the Admin probe and physical observation, exposing exact-byte equality
in the runner/operator front gates. Repair those gates to preserve raw physical
measurements while permitting nonnegative growth; Admin's existing bounded-drift,
growth, overlap-reservation, sample-floor and reserve checks remain authoritative
and unchanged. Verify through the approved native build-through-Admin seam before
any explicit pilot resume. Complete catalog, live baseline and manual activation
remain outstanding, so this feature stays in progress.

The capacity repair shipped in PR #2696 and the explicit pilot resume passed
live capacity admission. Import preparation then returned HTTP 409 before any
model work. Production has `CI=true`; the real receiver environment reproduced
string-valued import budgets because that flag bypasses environment coercion.
The native public import handler reproduces the resulting unconfigured-budget
conflict with the exact approved values. Normalize numeric configuration at the
import boundary while retaining safe-integer, positivity and exhaustion checks;
keep the 256 MiB object budget, 128 MiB temporary budget and 1 GiB temporary
reserve unchanged. The generation remains incomplete with no model calls.

After PR #2697, import succeeded and the authorized production pilot recorded
four successful profile maps and one terminal `profile_node_bytes_exceeded`
rejection, with known usage and no edge calls. The rejected response was not
retained, so an exact production replay is unavailable. The scoped repair keeps
the useful profile schema and full transcript/candidate coverage, aligns the
complete-node application cap to 4,096 bytes, reserves 5,120 bytes per physical
profile call, and bounds profile status replies to 1 MiB. Prompt version
`complete-profile-v3` requires a new generation; old terminal ledgers remain
immutable and compatible GA origin reuse still requires the existing checks.
Native exact-boundary verification also exposed the PostgreSQL spaced-JSON
constraint dependency. Deployment, generation completion, live baseline and
manual activation remain outstanding; measured storage and allowance gates
remain authoritative.

The 4 KiB repair shipped and the formerly oversized profile became ready with
seven anchors. A later map rejected an invalid anchor after three accepted
parts of a six-part profile, with complete observed usage. Preserve this work
and evidence validation through an explicit, once-only known-rejection
replacement reservation in the same generation with unchanged node input.
Its immutable authorization and separate audit reservation retain both charged
receipts; pending replay or another rejection stops. This is a narrowly scoped
manual continuation, not a prompt change or automatic retry loop. Catalog
completion, live baseline and manual activation remain outstanding.

For the current design phase, distinguish confirmed decisions, recommendations,
and open questions; cross-check repository claims against code and existing
evidence. Format-check edited Markdown. Do not mark this feature complete when
only the design interview is complete.

Implementation verification must cover eligible-visit denominator integrity,
zero-card results, bot exclusion, duplicate events, card/visit attribution,
technical-failure fallback with original-arm accounting, tracking loss,
generation freeze, and manual activation separation. Specify
the exact checks in the implementation plan and validate page-loading impact
for any new client telemetry.

Also verify compact-format semantic parity, raw-to-aggregate count reconciliation,
and bounded history cleanup. Measure native PostgreSQL heap/index/TOAST storage,
WAL, bytes per visit/connection/generation, projected retained footprint, and
build/rollback overlap. Prove cleanup throughput under loaded conditions;
distinguish reusable pages from recovered volume space. Reuse the existing
compression work rather than adding a parallel verbose ledger.

### October 14 profile byte-capacity repair

The fresh v3 pilot stopped on a known-usage `profile_node_bytes_exceeded`
map rejection (918 output tokens). Its raw response and measured rejected byte
length were not retained; the regression fixtures are not exact production replay.
Keep the full profile schema, eight grounded anchors, complete transcript/part
coverage, and complete candidate pools. Raise canonical nodes to 16,384 UTF-8
bytes, physical-call reservations to 17,408 bytes, and PostgreSQL JSONB text
guards for call nodes and final profiles to 32,768 bytes in additive migration 0149. Version the manual profile prompt as `complete-profile-v4`; require a new
generation and retain every prior generation, receipt, and terminal profile.
Compatible sealed GA origin reuse still requires the existing identity checks.

Profile status stays bounded to 127 physical calls and 4 MiB; only the shared
HTTP reader's `profile_status` action receives that response limit. Other
request/response limits remain unchanged. Map and reduce prompts stay at 65,536
bytes. Reduce contiguous ordered groups of two to eight children, choosing the
largest group whose actual rendered system plus prompt bytes fit; grouping and
dispatch share the renderer. Keep every child and final postorder coverage proof.
Edge execution retains page shrinking/member splitting and full pool coverage.

The map/reduce output-token cap stays at 2,048; the larger byte limit does not
guarantee every schema-valid model answer can be generated. The global node
budget remains authoritative: some combinations of all Unicode
schema maxima exceed 16 KiB. Do not truncate fields or weaken grounding. The
125-profile pilot's worst-case physical-call reservation is 276,352,000 logical
bytes; the 1,031-profile catalog's corresponding bound is 2,279,351,296 bytes,
which exceeds the 2 GiB bootstrap projection. Neither is a measured physical
storage forecast. Full-catalog admission requires separate retained/overlap and
measured-storage review. Production resume, catalog completion, baseline, and
public activation remain separate gates.

### October 14: bounded destination import verification

The fresh v4 pilot stopped before any model call or persisted import row. Admin's
GA prepare request reached its unchanged 120-second HTTP limit while reconstructing
the destination identity through sequential per-video catalog transactions.
`ga-capture-import-identity.ts` now verifies at most four videos concurrently,
below the existing ten-connection pool. Pagination remains sequential within each
video; all catalog, selection, observed-version and complete-chunk checks remain.
Each window settles before errors propagate, and corpus hashes are updated in
sorted video order. Metadata-only videos still receive their fenced chunk read.
No origin-hash shortcut, cross-request cache, retry or timeout increase is added.
Native public-service tests cover all 1,031 videos, multi-page transcripts, the
original sequential corpus digest, out-of-order completion and error draining.
Production continuation and full-catalog capacity qualification remain operator
steps after normal review, merge and deployment.

### October 14: bind map citations before model selection

The deployed 16 KiB profile and bounded import repairs passed live verification:
GA preparation completed in 26.6 seconds and copy/bind in 31.7 seconds. The v4
pilot then retained six ready profiles and ten successful physical map calls.
Two later maps of the same six-part transcript rejected `profile_map_anchor_invalid`;
the explicit replacement for the first rejection succeeded, while the final part
rejected separately. All twelve physical-call receipts have complete known usage,
zero calls remain pending, and no recommendation source has finalized. Preserve
these receipts and the existing single-replacement authorization. Rejected raw
answers were not retained, so exact quotation-error replay is unavailable.

The scoped repair changes the map response from copied quotation text and
fragment identifiers to a citation ID selected from exact spans prepared for
that map part. Repeated text at different source offsets receives distinct IDs.
The server resolves only current-part offers and materializes the existing
video/chunk/transcript/language, UTF-16 range and text-hash proof. Unknown IDs
reject the whole map with observed usage; no fuzzy match, evidence omission or
retry is introduced. Citation identity establishes provenance, not the semantic
truth of the model's English claim.

Render every original selected transcript fragment as ordered text segments
with citation labels, preserving every character and whitespace exactly once.
Joining each fragment's segment text must reproduce the original UTF-8 bytes;
short or whitespace-only segments remain readable even when they have no citation
ID. This supplies the complete transcript without duplicating it as an offer
list. Expose citations throughout each part, retain every profile field and up
to eight anchors, and respect Unicode scalar boundaries and exact offsets.
Count actual rendered prompt and schema overhead before reserving a call; retain the 65,536
byte prompt, 16,384 byte materialized node, 17,408 byte call reservation, 2,048
output-token, 64-part and 127-call bounds. The reducer still copies only verified
child anchors and covers the complete ordered child range. Persisted profile
and Admin evidence contracts do not change.

Version the changed map wire/prompt identity as `complete-profile-v5`; start a
new generation after normal review and deployment, keeping v4 immutable and
reusing the sealed analytics origin only through the existing identity checks.
A fresh pilot must demonstrate completion and support measured capacity review
before full-catalog admission. Deterministic fixtures cover citation ambiguity,
later spans, Unicode offsets, unknown IDs, complete input coverage, replay and
byte/schema bounds; they do not establish live recommendation quality.

## Lossless reducer references after the v5 pilot

The v5 pilot completed the formerly blocked Children’s profile with all eight
maps and its reduction, then stopped on a later 26-map profile's first reduction.
That call recorded 27,143 input and 2,249 output tokens against the unchanged
2,048 output-token request. A schema-valid synthetic response with those usage
counts deterministically triggers the adapter cap rejection and the public
`profile_adapter_output_invalid` receipt; the discarded production response is
not available for an exact replay or exclusion of additional schema problems.

For `complete-profile-v6`, each reducer receives full readable child profiles
with enumerated references scoped to the exact child digest and anchor index.
It returns references for up to eight anchors; the server restores every original
anchor field and claim exactly before the existing provenance and node checks.
Summary, themes, people, places, citations, complete transcript and ordered child
coverage remain unchanged. Unknown references fail closed. Actual rendered
system, input and dynamic schema bytes govern grouping and dispatch before
reservation; empty anchors avoid empty enums and `oneOf`. All existing byte,
2,048-token, 64-part and 127-call limits remain unchanged. V4/v5 wire contracts
and receipts retain their prior behavior. Deterministic tests establish lossless
rehydration and native persistence/replay, not a live output-size guarantee.

The old v4/v5 generations were closed using the normal cancellation lifecycle
as superseded, never activated runs. Immutable call/profile evidence, input and
execution bindings, analytics artifact and sealed origin remain preserved under
the existing diagnostic retention policy. Start a fresh v6 generation only after
normal review/release and the unchanged account, capacity, corpus, origin and
pilot gates; do not resume v5 or introduce retries or recovery exceptions.
