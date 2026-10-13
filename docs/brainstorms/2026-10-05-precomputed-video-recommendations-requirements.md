---
date: 2026-10-05
topic: precomputed-video-recommendations
status: agreed
roadmap: feat-590
---

# Precomputed Video Recommendation Experiment

The user confirmed the shared design on October 5, 2026. They believe the
historical GA warehouse is BigQuery; its project/dataset and access are still
unverified. Tracking extends the existing recommendation ledger. The user
requires minimal, bounded Railway database storage and explicitly excludes
BigQuery export from this experiment. Design agreement does not activate
public serving.

## Confirmed intent

- Build an experiment that periodically examines the video catalog and finds
  connections using transcripts, metadata, and historical analytics.
- Store precomputed connections and recommendations in PostgreSQL so an
  individual Watch video page can serve them without model inference during
  the viewer request.
- Use past analytics for the first build; incorporate new videos and newly
  arrived analytics in subsequent periodic computation.
- Keep the existing recommendation system available during development and
  evaluation. Public activation comes later; reverting to the existing system
  must remain possible if the experiment fails.
- Use GPT-6 Astra for the first build. Project account access remains untested;
  official API identifiers and published pricing have been checked below.

## Settled decisions — round 1

1. **Relationship choice belongs to the model per Video.** Do not impose one
   catalog-wide objective of similarity, next viewing, or unexpected relevance.
   The model determines which connections make sense for the source Video.
2. **Recommendations are shared.** The experiment does not generate
   viewer-specific recommendation lists.
3. **Catalog-wide discovery, variable connection count.** Every eligible Video
   participates in discovery; explicit judgment of every possible pair is not
   required. Seek all worthwhile connections found by that discovery process,
   rather than stopping after one pair or imposing a six-result storage quota.
   One Video may have one connection and another six, seven, eight, or more.
   This does not claim exhaustive recall of all possible connections. Round 2
   resolves the viewer-facing count and delegates alternative choice to the
   model.
4. **A/B evaluation with CTR as the deciding metric.** Assign some viewers the
   existing recommendations and others the experiment. Higher CTR should win.
   Round 3 settles visit-level CTR and the possibility of an inconclusive
   result. Round 4 settles assignment and manual promotion. The exact stopping
   rule and treatment of incomplete tracking still need the measurement audit.
5. **Measure the first build before deciding cadence.** The user sets no spend
   or runtime ceiling for the first build. Report its actual usage/cost and
   elapsed time, then let the user choose refresh frequency based on that
   evidence. Do not substitute the earlier proposed pilot budget gate or
   silently choose a recurring schedule. This decision does not resolve the
   remaining design questions or activate live serving.

## Settled decisions — round 2

6. **Retain all accepted connections; display up to six.** Use the existing
   card layout and the best currently eligible recommendations. A source with
   only one worthwhile recommendation may show one; do not require six stored
   connections or automatically pad a small list.
7. **The model chooses alternatives when direct connections are absent.** The
   proposed automatic return to the incumbent on an empty connection set was
   not accepted. Model judgment determines what to suggest instead, within the
   precomputation design. Round 3 resolves exhausted language-specific
   inventory; no online inference or invented relationship is implied.
8. **One working language, reused across audio languages.** Compute the
   recommendation relationships once in a single working language. For another
   audio language, filter the saved choices to targets actually playable in
   that language. Do not create independent semantic rankings per language.
   Round 3 selects English and resolves the missing-transcript policy.
9. **The model weighs content and analytics, with explainable connections.**
   Lack of historical exposure must not count against an otherwise suitable
   Video. Analytics do not remove the requirement to explain a recommendation.
10. **Inspect the prototype in Admin.** Select a source Video and compare
    existing versus experimental recommendations, including the model's
    reasons and supporting transcript passages. Do not fabricate transcript
    support when the input does not contain it.

## Settled decisions — round 3

11. **English reasoning and explanations, with honest evidence coverage.** Use
    available non-English transcripts when needed. Metadata-only
    recommendations are allowed when transcripts are absent, with that basis
    clearly marked in Admin. English as the working language does not restrict
    the input catalog to videos with English transcripts or English Dubs.
12. **Precomputed alternatives and empty-result behavior.** Save model-chosen
    alternatives alongside direct connections. Filter both for current
    playback availability in the selected audio language. If no eligible
    target survives, hide the row and expose the coverage gap in Admin.
    Model inference never happens during a viewer request.
13. **Visit-level CTR, excluding bots.** The primary metric is eligible Watch
    visits with at least one recommendation click divided by all eligible
    Watch visits. Count each visit at most once in the numerator. Visits with
    no experimental results remain in the denominator. Bot traffic must not
    be eligible and must not enter either numerator or denominator. Keep card
    CTR as a secondary diagnostic. Eligibility must be independent of the
    assigned strategy's recommendation output.
14. **A clear winner or an inconclusive result.** Agree the stopping rule before
    live testing; do not promote from a noisy numerical lead. Keep the current
    system if the evidence is inconclusive. CTR remains the deciding metric.
15. **Astra first.** Use `gpt-6-astra` for the initial catalog build, report its
    actual cost and results, then consider cadence or a Sol comparison.
16. **Chapters and related films are allowed when useful.** The model may
    recommend another chapter or the parent film when it explains the added
    viewing value. Exclude the source itself, duplicate copies, and another
    Dub of the same Video from distinct recommendations.

## Settled decisions — round 4

17. **50/50 with stable browser assignment.** Keep an eligible browser in the
    same arm throughout the test. The experiment identity supports assignment
    and measurement only and is not a model input. Exact implementation must
    respect the existing measurement/consent boundaries.
18. **Include the historical GA warehouse.** The user has a warehouse of older
    Google Analytics statistics and intends to provide access so the model can
    use that history. Do not restrict the initial build to Admin's retained
    recommendation events. Warehouse provider, dataset identifiers, schema,
    authentication, and event-to-catalog mapping have not been established.
    The user did not simply accept the previous predefined aggregate-input
    proposal; the intended breadth is the available historical warehouse.
19. **Freeze the first experiment's results.** Hold the experimental generation
    and control algorithm configuration fixed during the first test, while
    preserving ordinary control personalization and applying current
    publication/playback restrictions. Use a declared source-catalog cohort;
    later source additions stay outside this test in both arms. Failed builds
    leave the previous complete results intact.
20. **Persist the result; activation belongs to a later user instruction.**
    Store a retrievable winner/inconclusive report. Admin and an authenticated
    AI read path should be able to retrieve the same result. A completed build
    or favorable evaluation must never activate public serving automatically.
    The user intends to ask another ChatGPT chat to activate it manually.
    This is a future workflow, not a request to create or message another chat
    now. Preserve the incumbent for immediate rollback.

## Design confirmation

21. **Warehouse provider provisionally identified.** The user believes the
    historical warehouse is BigQuery. Verify its actual source, project,
    dataset, historical coverage, and authorized access during source
    inspection; no credential has been provided.
22. **Shared understanding confirmed.** The user approved the consolidated
    recommendation, review, measurement, and manual-activation design. Do not
    repeat the design-confirmation gate. Implementation planning can proceed;
    the known data-access and prelaunch measurement details remain explicit
    follow-up work.

## Settled operational clarification

23. **Fall back on technical delivery failure.** The user accepted attempting
    the existing recommendations when loading experimental recommendations
    fails. Record the actual delivered strategy and failure, and keep the visit
    in its assigned experimental arm for the primary analysis. Expose fallback
    rates in Admin and the stored result so failures cannot silently make the
    experiment look better. A valid empty result still follows the agreed
    hide-row behavior. A failed background build retains the previous complete
    generation under the separately agreed build policy.

## Repository findings

- `CONCEPTS.md` is the established project glossary. Extend it rather than
  introducing a competing root glossary. A Video is distinct from a Dub and
  Video Edition; "entire catalog" must not silently count every dub as separate
  creative content.
- `apps/admin/src/services/recommendations/delivery-retriever.ts` currently
  samples transcript embeddings and retrieves candidates during delivery.
- `apps/admin/src/services/recommendations/delivery.service.ts` supports
  semantic contextual and hybrid personalized execution with delivery tracking
  and fallback. The experiment needs an explicit comparison baseline rather
  than assuming that all existing recommendations are similarity-only.
- Experiment primitives exist in `apps/admin/prisma/schema.prisma` and are
  documented by `feat-384`. Their suitability for this experiment is still to
  be assessed; existence does not imply a completed causal comparison.
- `feat-473` links recent analytics reports documenting incomplete impression
  matching, source-neutral playback evidence, and language-coverage issues.
  Observed clicks reflect prior exposure and measurement coverage. They cannot
  directly establish that an unexposed video is undesirable.
- `feat-476` concerns one-time editorial fallback curation and explicitly
  excludes recurring AI computation. This experiment has its own ticket.
- `apps/admin/src/services/recommendations/contracts.ts` currently sets
  `MAX_DELIVERY_ITEMS = 6`. A variable-sized stored connection set and a
  variable-sized public recommendation row are separate design choices.
- `apps/admin/src/services/recommendations/eligibility.ts` checks exact audio
  language, published display locale, Watch visibility, playback, and artwork.
  Stored connections alone do not prove a target can currently be served.
- `docs/reports/2026-10-01-recommendation-ctr-history/report.md` defines the
  existing reported CTR as matched selections divided by qualified card
  impressions. It documents unmatched clicks and cautions that the matched
  subset is incomplete. This is historical evidence, not a fresh production
  health assessment.
- `apps/admin/src/services/recommendations/experiment/assignment.ts` currently
  admits equivalent semantic A/A manifests and a specific hybrid experiment.
  It is not a general plug-in path for a new precomputed challenger.
- `apps/admin/src/services/recommendations/experiment/policy.ts` uses
  `recommendation-experiment-aa-v1`; its pass state checks evidence health,
  assignment minimums, and guardrails, not a higher-CTR A/B winner. Reusing
  those primitives must not be described as already implementing this test.
- `docs/recommendations/curation/2026-09-10/coverage-report.md` documents sparse
  language inventories, including languages with only one visible playable
  source Video in that older public Core snapshot. It does not establish
  current Admin availability. Model judgment cannot manufacture a second
  eligible title where inventory is exhausted.
- `apps/web/src/app/api/recommendations/route.ts` currently derives
  `eligibleHuman` from a bot user-agent pattern and prefetch/prerender headers;
  an absent user agent is accepted. This is a heuristic rather than positive
  human verification. Bot exclusion needs a documented server-owned policy
  shared by assignment, visits, clicks, and aggregate-input qualification.
  Inspect available trusted edge signals during implementation; do not assume
  Cloudflare bot-score access or perfectly classified traffic.
- `apps/web/src/lib/recommendation-session.ts` gives the existing anonymous
  recommendation session a 24-hour cookie lifetime. Full-experiment browser
  stickiness cannot be promised by simply reusing that identity unchanged.
- The public Web delivery route also attempts contextual recovery for empty
  or unavailable incumbent results. Experimental empty results must preserve
  the agreed hide-row behavior rather than accidentally entering that path.
- `apps/mastra/src/services/google-analytics-client.ts` uses the GA4 Data API
  for allowlisted date/landing-page aggregate reports. It is not a general
  warehouse client and cannot be assumed to expose historical video events or
  transitions. No warehouse dataset identifier or connected warehouse tool was
  found in the inspected recommendation/analytics paths.
- `apps/mastra/src/services/google-auth-client.ts` and `feat-345` establish
  renewable server-side Google authentication patterns. Reuse appropriate
  patterns without treating existing SEO credentials or permissions as
  authorization for an unspecified warehouse.
- `apps/admin/prisma/schema.prisma` already defines
  `RecommendationServedItem`, `RecommendationRenderedFact`,
  `RecommendationImpression`, `RecommendationSelection`, experiment assignment,
  and playback/evaluation records. `WatchSemanticRecommendations.tsx` and the
  same-origin `/api/recommendations/evidence` and `/select` routes already
  capture render/impression and accepted card-selection evidence. This is an
  existing foundation, not proof that all click paths or the new experiment's
  visit denominator are covered.
- `apps/admin/src/services/recommendations/contracts.ts` sets raw recommendation
  retention to 29 days. A long test needs an explicit retention/aggregation
  design so its evidence does not silently expire before evaluation.
- This checkout predates the merged recommendation storage optimizations
  referenced below. Its older row layouts are not the implementation baseline;
  integrate with the optimized schema and readers before adding telemetry.

## Tracking and storage recommendation

The user asked whether card-click tracking and an analytics data store are
needed, and whether Railway can provide storage. Recommended first build:
extend the existing first-party telemetry and Admin PostgreSQL ledger, using
the same recording contracts for both experiment arms. The observations below
are logical evidence requirements, not instructions to create a second event
ledger or duplicate existing fields. Minimize additional persisted data.

| Observation                          | Minimum evidence                                                                                                                               | Why it is needed                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Eligible Watch visit                 | Visit identity, experiment/arm, assignment identity, source Video, audio language, timestamps, server-owned eligibility classification/version | Primary CTR denominator, including visits that get zero cards      |
| Recommendation delivery              | Visit/request binding, actual strategy and generation, target IDs and positions, direct/alternative provenance, empty/error result             | Proves what the assigned visit actually received                   |
| Card render and qualified impression | Visit/request/item binding, event identity, visibility policy, occurred/received times                                                         | Separates delivery from visibility and supports secondary card CTR |
| Recommendation click                 | Visit/request/item binding, unique event identity, clicked target, position, occurred/received times                                           | Card-level analysis and at-most-once clicked-visit numerator       |
| Subsequent playback                  | Existing selection/episode binding and supported playback outcomes                                                                             | Diagnostic context without changing the agreed primary metric      |

Join strategy, position, target, and generation from server-issued delivery
records instead of trusting browser-supplied attribution. Deduplicate retries
and bind click evidence to the eligible visit before evaluation. Preserve
legitimate clicks without a qualified preceding card impression: the primary
visit CTR must not inherit the old matched-impression requirement. Record
tracking loss and unknown eligibility explicitly, apply the same bot/test
exclusions to numerator and denominator, and do not claim perfect bot
classification from the current user-agent heuristic.

Recommended data flow:

`Watch → first-party tracking API → Admin PostgreSQL`

- PostgreSQL is the immediate event/experiment source and serves Admin and
  authenticated AI result queries. Persist versioned evaluation results and
  purpose-appropriate aggregates with explicit retention so evidence expiry
  does not erase the stored result. Do not silently extend existing raw-data
  retention or replicate excluded viewer identities.
- Keep the existing historical warehouse as a read-only generation input.
  **BigQuery export is out of scope:** no export job, destination dataset,
  warehouse writer, export outbox, or export-specific credentials/storage.
- Reconcile the event ledger against experiment totals and validate click,
  empty-result, duplicate, bot, and navigation-loss cases before the A/B test.
  Check physical storage growth and write/query load against current database
  capacity before enabling traffic, as specified below. A new analytics
  database is not part of this prototype.

Railway provides PostgreSQL deployment; the application owns instrumentation,
analytics semantics, and data retention. Source checked October 5, 2026:
[Railway PostgreSQL](https://docs.railway.com/databases/postgresql).

### Railway storage constraint and existing compression work

The user explicitly requires saving as little as possible because Railway
storage is limited. The first build's unrestricted model spend/runtime does
not authorize unbounded database growth. Preserve the existing storage work:

- [PR #2429](https://github.com/JesusFilm/forge/pull/2429) replaced candidate-stage
  row fan-out with a compact, versioned JSONB trace per candidate run while
  preserving trace history and retention. Do not recreate verbose per-stage
  candidate rows for this experiment.
- [PR #2481](https://github.com/JesusFilm/forge/pull/2481) packed immutable
  multi-item presentation/provenance snapshots onto the request, retaining
  thin relational served-item rows and mixed-format readers. Single-item
  requests remain inline. Reuse these contracts, including exact historical
  snapshots, rather than reconstructing history from mutable catalog data.
- [PR #2479](https://github.com/JesusFilm/forge/pull/2479) removed redundant fact
  indexes, and [PR #2522](https://github.com/JesusFilm/forge/pull/2522) reduced
  internal exposure-ID storage while retaining public event UUIDs and replay
  semantics. Avoid redundant indexes and unnecessarily large internal IDs.
- [PR #2540](https://github.com/JesusFilm/forge/pull/2540) closed the storage
  optimization work separately from the remaining loaded-retention capacity
  proof. [PR #2556](https://github.com/JesusFilm/forge/pull/2556) subsequently
  improved cleanup deadline margin; successful empty cleanup runs still do
  not prove capacity under normal traffic.

Implementation requirements:

1. Store accepted relationships, English explanations, and evidence once per
   immutable generation. Prefer references to existing versioned transcript
   evidence; retain only the small excerpts needed when references alone
   cannot preserve reviewable support. Do not copy full transcripts, catalog
   metadata, prompts, raw warehouse rows, or explanations into visit records.
2. Reuse existing compact delivery and evidence records. Add only the missing
   visit/assignment/generation bindings needed for fair measurement, including
   zero-result visits. Preserve exact served-card attribution, event deduplication,
   and bot exclusions; storage savings must not sample away the denominator.
3. Define bounded retention for superseded generations, failed-run diagnostics,
   and evaluation revisions. Protect the active generation, required rollback
   generation, and evidence needed for the fixed A/B test. Retain every accepted
   connection in a retained generation; the six-card display limit is not a
   graph storage quota. Do not accumulate every build and model response forever.
4. Preserve the existing 29-day request-owned raw-evidence lifecycle and its
   descendant expiry rules. Before a longer test starts, define compact
   sufficient statistics that preserve the agreed inference method, browser
   assignment, deduplication, and late-event handling. Persist the versioned
   result without indefinitely keeping raw visits. Do not silently shorten
   retention or extend it to make evaluation work.
5. Measure the additional footprint with native PostgreSQL fixtures and actual
   catalog size: bytes per eligible visit, per accepted connection, and per
   retained generation; projected daily growth and full-retention footprint;
   heap, indexes, TOAST, WAL, and maintenance headroom. Include concurrent
   generation builds and rollback overlap. Set a capacity budget against the
   available Railway volume before enabling traffic; no numeric budget or
   monthly growth forecast is established yet.
6. Verify retention with realistic expired roots, descendants, concurrent writes,
   and cleanup throughput. Report reusable database space separately from
   filesystem space recovered: deleting rows does not necessarily shrink the
   Railway volume. Existing retained-data cleanup or destructive reclamation is
   outside this feature.

Read these merged repository documents when planning implementation; they are
newer than the current checkout:

- `docs/operations/recommendation-served-snapshot-format.md`
- `docs/solutions/best-practices/recommendation-trace-capacity-and-retention-proof-20260928.md`
- `docs/solutions/best-practices/recommendation-storage-semantic-and-physical-proof-20260930.md`
- `docs/solutions/performance-issues/recommendation-storage-recovery-metrics-20261002.md`
- `docs/plans/2026-09-30-001-recommendation-storage-efficiency-plan.md`
- `docs/roadmap/platform/feat-574-recommendation-storage-efficiency.md`

Use the outstanding `feat-554` retention-capacity work as an implementation
input. Published fixture savings are evidence for their tested formats, not a
prediction of this experiment's production footprint.

## Historical warehouse integration proposal

The warehouse source is confirmed; the following access shape is proposed for
the final design review, pending the source location and schema inspection.

- Give the background model read-only tools to explore the full authorized
  historical range, inspect available event/metric definitions, and request
  video-level or video-to-video evidence. The model may choose useful queries;
  do not limit it to an arbitrary recent report or silently treat one prompt
  as ingestion of an entire warehouse.
- Keep credentials in service configuration. Tools execute authenticated
  queries; provider keys, raw credentials, and individual viewer identities
  never become recommendation prompts or persisted model outputs. Compute
  transition aggregates within the warehouse when valid source identifiers
  and event ordering support them.
- Map legacy video IDs and URLs to canonical catalog identities. Preserve
  unmapped coverage and measurement-version differences rather than guessing
  joins. Keep warehouse and native analytics provenance separate and reconcile
  overlap before combining totals.
- Capture query identity, source date range, input cutoff, result hashes,
  record counts, bot-filter basis, and coverage qualifications with each build.
  Missing historical bot evidence is unknown, not verified human traffic.
  Historical GA engagement informs generation; the live experiment uses its
  explicitly defined human-visit and click measurements.
- Include warehouse query charges/usage in the first-run cost report,
  separately from model tokens and other execution costs. Label estimates
  when final billing is not available.

If the source is BigQuery, Google documents that API keys are not supported for
authentication; the application needs Google credentials such as ADC/service
account access. The actual warehouse has not yet been identified. Source:
[BigQuery authentication](https://docs.cloud.google.com/bigquery/docs/authentication/getting-started),
checked October 5, 2026.

## Stored experiment result and manual activation

The report must be addressable by experiment ID and evaluation revision, with
the tested generation/control version, cohort and time window, both arms'
eligible-visit and clicked-visit counts, bot exclusions, primary CTR and
uncertainty, secondary card CTR, measurement-health findings, stopping-rule
version, and winner/inconclusive outcome. A recommendation to promote is data
in this report; reading it never changes serving state.

The user's later activation instruction must identify the reviewed experiment
and generation. Implement one authenticated control path usable by an
authorized operator/agent, with recorded activation and rollback. Do not let
an evaluator, report reader, or content-generation model silently promote a
generation. The exact result/control API is an implementation design item.

## Model documentation checked on October 5, 2026

Official model pages document `gpt-6-astra` and `gpt-6.1-sol`, both with
structured output support. Published standard text pricing per million tokens
is $10 input / $50 output for Astra and $2 input / $10 output for Sol. Cache,
long-context, and processing-mode rates differ; these headline rates are not a
whole-catalog estimate. Both pages specify higher full-request rates above
272K input tokens. Record actual usage and the applicable pricing mode when
reporting the first build's cost.

Sources: [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra)
and [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol).
Published availability does not prove this project's account access; no model
request has been made for this experiment.

## Design tree

Rounds 1–4, the design confirmation, and Q23 are agreed. No further product
questions remain for this design interview. Remaining work is implementation
planning and the explicit source/measurement checks below.

### Remaining implementation inputs

- Obtain the warehouse's non-secret console URL or project/dataset identifier
  and configure authorized access. Inspect source schema, available history,
  authentication options, and video identifiers. The user need not paste a key
  in chat.
- Validate the tracking extension and storage approach above against the merged
  compact formats, existing events, retention, database capacity, and the
  human-visit denominator. Measure available volume headroom and projected
  retained bytes before defining the storage budget.
  Source discovery may expose a material question; surface it without
  reopening settled product choices.

### Later branches and their prerequisites

- Confirmed shared understanding → implementation plan; no new confirmation
  is required merely to carry the agreed design forward.
- Warehouse location and authorized access → source adapter, historical
  identity mapping, aggregation/tool shape, and actual analytics coverage.
- Inventory and retained-data audit → exact coverage, input size, source
  evidence qualification, batching, and reproducible cost accounting.
- Trusted bot/measurement audit and human visit baseline → precise eligibility,
  visit identity and click-attribution rules, sample size, and a versioned
  stopping rule agreed before public A/B activation.
- Measured first-build cost → user-selected refresh cadence. This decision is
  intentionally deferred by the user; do not choose a schedule in advance.

### Engineering direction

- Keep model execution and warehouse access in the existing Mastra runtime;
  Admin owns catalog access, native analytics qualification, PostgreSQL
  results, review, experiment reporting, and consumer delivery. Use
  authenticated service contracts with no cross-app imports.
- Review each source's transcript/metadata, construct evidence-backed catalog
  summaries, discover across the catalog, and re-read source passages for
  proposed connections. Preserve discovery beyond incumbent candidates and
  avoid claiming exhaustive pairwise analysis.
- Let the model rank each source's direct connections and alternatives. Do not
  infer that recommending B from A automatically means recommending A from B.
- Persist input cutoff/hashes, model and prompt versions, ranked target IDs,
  relationship rationale, evidence references, alternate status, and actual
  usage. Validate IDs and evidence before a completed result can be served.
- Build separately versioned generations and publish completed results
  atomically. Failed or partial runs remain inspectable for a bounded retention
  period without replacing a working generation. Availability restrictions are
  always checked at serving.
- Make scheduled refreshes reconsider older source Videos when new potential
  targets arrive, rather than generating recommendations only for new sources.
- Keep the experimental tables, worker, and serving choice removable while
  preserving the incumbent and its data.

## Documentation decisions

Use the established glossary for settled domain language. No ADR is warranted
yet: the experiment is deliberately reversible, and no difficult-to-reverse
architectural trade-off has been settled. Record an ADR only if such a decision
emerges during the interview.

Application implementation has not started. The design interview is complete.
The approved spec is saved at
`docs/plans/2026-10-05-001-precomputed-video-recommendation-spec.md` and published
as [#2565](https://github.com/JesusFilm/forge/issues/2565). Its ten child issues
(#2566–#2575) and verified native dependency graph are recorded under
`docs/plans/2026-10-05-precomputed-video-recommendation-tickets/`. The user approved
the testing boundaries and ticket breakdown, then requested a kickoff prompt
for an orchestrator using GPT-6 Sol chats and Matt Pocock's implement workflow,
with Compound Engineering skills explicitly prohibited. That prompt is saved at
`docs/plans/2026-10-05-precomputed-video-recommendation-orchestrator-prompt.md`.
Preserve the explicit data-access, measurement-validation, and later activation
stages; do not reopen the already confirmed core design.
