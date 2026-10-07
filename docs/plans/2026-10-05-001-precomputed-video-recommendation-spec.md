---
date: 2026-10-05
title: Precomputed Video Recommendation Experiment
status: approved
roadmap: feat-590
tracker: JesusFilm/forge
publication: published
issue_url: https://github.com/JesusFilm/forge/issues/2565
---

# Precomputed Video Recommendation Experiment

## Problem Statement

The team wants to learn whether a capable reasoning model can discover useful
relationships across the video catalog using transcripts, metadata, and past
viewing analytics. A relationship may be similarity, a useful next thing to
watch, or an unexpected connection; the appropriate choice varies by source
Video. Existing recommendations must remain available while this experiment
is developed and evaluated.

Running a model during a Watch visit would add latency and repeat work shared
by many viewers. Precomputation should make results inexpensive to serve, but
storing verbose model output and duplicated tracking could exhaust the limited
Railway database volume. The team also needs a fair, bot-filtered comparison:
showing fewer recommendations, dropping failed visits, or counting repeated
clicks must not manufacture a winning CTR.

## Solution

Build a separate, initially private recommendation strategy. GPT-6 Astra
examines the eligible catalog and authenticated historical analytics offline,
producing explainable, directed Video Connections and Model-Chosen Alternatives.
Admin stores complete, versioned generations in PostgreSQL and provides a
source-video comparison with the incumbent, English explanations, and honest
transcript or metadata evidence.

Watch serves the highest-ranked eligible saved choices, up to six, in its
existing recommendation layout. Relationships are computed once in English
and shared across viewers and audio languages. Serving filters targets to
current playback availability in the viewer's selected audio language; it
never calls the model. A valid empty result hides the row. Technical loading
failure attempts the incumbent, with the failure and actual delivered strategy
recorded separately from the visitor's assigned experiment arm.

After explicit activation, compare the incumbent and a frozen experimental
generation with a stable 50/50 browser split. Decide using Recommendation Visit
CTR under an agreed stopping rule, retain card CTR as a diagnostic, and publish
a versioned winner or inconclusive report. Only a later explicit operator
instruction can promote the experiment. Preserve the incumbent for rollback.

## User Stories

1. As a viewer, I want useful recommendations related to my current Video, so
   that I can discover something worth watching next.
2. As a viewer, I want recommendations to load without waiting for a model, so
   that recommendations do not delay playback.
3. As a viewer, I want every recommended target to play in my selected audio
   language, so that following a card preserves my viewing context.
4. As a viewer, I want a source with one worthwhile connection to show one
   card, so that the row does not contain filler.
5. As a viewer, I want the best six eligible choices when more are available,
   so that the existing layout remains usable.
6. As a viewer, I want useful broader alternatives when direct connections
   cannot serve my language, so that discovery can still work.
7. As a viewer, I want the row hidden when no saved choice is playable, so that
   unavailable recommendations do not mislead me.
8. As a viewer, I want the existing recommendations attempted on a technical
   failure, so that the experiment degrades gracefully.
9. As a viewer, I want source and target playback to remain usable when
   recommendation tracking fails, so that measurement does not interrupt me.
10. As a viewer, I want useful chapters or parent films when they add viewing
    value, so that related formats are not excluded arbitrarily.
11. As a viewer, I want the source itself, duplicate copies, and alternate Dubs
    excluded as distinct recommendations, so that cards offer different content.
12. As an operator, I want catalog-wide discovery, so that results are not
    restricted to candidates already chosen by the incumbent.
13. As an operator, I want the model to choose relationship types per Video,
    so that different source needs can produce different kinds of connections.
14. As an operator, I want every accepted connection retained within a saved
    generation, so that the display limit does not discard useful discoveries.
15. As an operator, I want transcripts and metadata considered together, so
    that connections have an explainable content basis.
16. As an operator, I want non-English transcripts usable with English
    explanations, so that English transcript gaps do not exclude content.
17. As an operator, I want metadata-only recommendations clearly marked, so
    that I can distinguish them from transcript-backed judgments.
18. As an operator, I want historical analytics to inform model decisions, so
    that the experiment can learn from past engagement.
19. As an operator, I want low exposure distinguished from poor engagement,
    so that overlooked Videos are not penalized for missing traffic.
20. As an operator, I want legacy warehouse identities mapped to canonical
    Videos with coverage gaps reported, so that unrelated analytics are not joined.
21. As an operator, I want model access to authorized historical data through
    read-only tools, so that exploration does not require warehouse writes.
22. As an operator, I want credentials and individual viewer identities kept
    out of model inputs and outputs, so that shared recommendations use only
    appropriate evidence.
23. As an operator, I want to select a source Video and compare both strategies
    in Admin, so that I can inspect the experiment before exposing viewers.
24. As an operator, I want reasons, supporting passages, and coverage gaps in
    that comparison, so that I can assess each recommendation's basis.
25. As an operator, I want interrupted builds to resume safely and incomplete
    generations to remain unservable, so that retries cannot publish partial work.
26. As an operator, I want failed rebuilds to preserve previous complete
    results, so that a refresh cannot remove working recommendations.
27. As an operator, I want refreshes to reconsider old Videos when new content
    or analytics arrives, so that new connections can improve the whole catalog.
28. As an operator, I want actual model usage, warehouse query usage, elapsed
    time, and storage growth reported for the first build, so that I can choose
    a refresh cadence from evidence.
29. As an operator, I want no recurring schedule enabled until I choose its
    frequency, so that the first build determines future operating cost.
30. As an analyst, I want a stable 50/50 browser assignment, so that repeated
    visits do not drift between strategies during the same test.
31. As an analyst, I want a frozen experimental generation and control
    configuration for a declared source cohort, so that the comparison has a
    consistent interpretation.
32. As an analyst, I want bot and test traffic excluded under the same policy
    in both arms, so that automated traffic does not determine the winner.
33. As an analyst, I want eligible visits counted even when they receive zero
    cards or a technical fallback, so that sparse results and failures do not
    improve CTR by disappearing from the denominator.
34. As an analyst, I want each visit counted at most once as clicked, so that
    retries and multiple card clicks cannot inflate the primary metric.
35. As an analyst, I want accepted clicks counted without requiring a prior
    qualified impression, so that the primary visit metric does not inherit
    an unrelated impression-matching restriction.
36. As an analyst, I want card position, actual delivery, render, impression,
    and subsequent playback evidence, so that I can diagnose differences
    without changing the primary metric.
37. As an analyst, I want tracking loss, fallback rates, and uncertain bot
    classification visible, so that I can judge whether the evidence is usable.
38. As an analyst, I want a predeclared stopping rule and an inconclusive
    outcome, so that a noisy numerical lead cannot trigger a false win.
39. As an operator, I want the same versioned result available in Admin and
    through authenticated AI access, so that a later chat can retrieve it.
40. As an operator, I want promotion and rollback to require explicit action,
    so that model output and evaluation never change public serving silently.
41. As an operator, I want compact records and bounded retained history, so
    that the experiment fits the available Railway storage.
42. As an operator, I want the existing raw-data retention and immutable
    served evidence preserved, so that storage optimization does not change
    measurement meaning or invalidate historical review.
43. As an operator, I want the experiment removable independently of the
    incumbent, so that an unsuccessful experiment can be retired safely.

## Implementation Decisions

### Ownership and default state

- Admin owns canonical catalog access, qualified native analytics, generation
  storage, review, serving eligibility, experiment evidence, and reporting.
- Mastra owns offline model execution and historical warehouse tools. Reuse
  the existing offline content-generation and authenticated Admin ingest
  patterns. This is a text/catalog workflow, not a new media-processing system.
- Web consumes Admin contracts through its existing server boundary. No
  cross-app runtime imports, direct browser warehouse access, or browser-held
  provider credentials are introduced.
- New feature configuration is optional and default-off. Migrations and
  private builds do not change the public strategy. Existing environment,
  retention-health, authentication, and admission controls remain effective.
- Extend typed consumer contracts additively and regenerate schema/client
  artifacts together where the public schema changes.

### Inputs, discovery, and model output

- Use exactly `gpt-6-astra` for the first build and verify access through the
  selected execution backend. Do not silently substitute a model. On October 8
  the owner selected a local Codex subscription build with reusable content
  profiles and batched connection decisions. This supersedes the October 6
  OpenRouter preference for new build work; preserve previous API receipts.
  Enforce ChatGPT authentication, structured output and explicit usage
  accounting. Do not fall back to a paid API or transfer the personal login to
  Railway. Watch continues to serve saved results independently of the build.
  Implementation slices and validation are in the
  [subscription build plan](2026-10-08-precomputed-recommendation-subscription-build.md).
- Treat Video as content identity, distinct from Dub and Video Edition. Use
  canonical source/target identity and existing eligibility rules.
- Establish a declared catalog/input cutoff. On October 7 the owner approved
  selecting one complete transcript per Video Edition: English when available,
  otherwise a complete non-English transcript. Keep every eligible Video and
  every passage of each selected transcript; record the selection policy,
  selected identities/languages, and incomplete or unavailable editions.
  Read this material and metadata; derive English working summaries as needed. Discover
  across all eligible catalog content and re-read supporting passages before
  accepting a transcript-backed judgment.
- Discovery may use existing retrieval and summaries to make catalog-scale
  work practical, but it cannot be restricted to the incumbent's delivered
  candidates. It does not promise exhaustive all-pairs reasoning or perfect recall.
- The model chooses the relationship, explanation, ordering, and broader
  alternatives for each source. Directed A-to-B judgments do not imply B-to-A.
  Missing exposure is unknown evidence, not a negative engagement signal.
- Validate target identity, self/duplicate/Dub exclusions, evidence references,
  provenance, and output shape before persistence can complete a generation.
  Label metadata-only judgments explicitly. Chapters and parent films require
  an explanation of added viewing value.
- Retain every accepted connection for each retained generation. Six is a
  display limit, not a discovery limit or stored-connection quota. Alternatives
  must also be precomputed and explainable; do not fabricate filler on requests.
- Treat transcripts, metadata, and warehouse text as data, not tool authority.
  The model cannot change serving controls, warehouse permissions, or its
  authorized data scope through content it encounters.

### Historical analytics

- The first build uses GA Data API property `320198532`; read-only service-account
  access is verified. Verify schema, history, and canonical-video mapping before
  claiming a qualified live build. Authenticate server-side; SEO permissions do
  not constitute authorization for this input.
- On 2026-10-06 the user approved validated Watch referrer links plus engagement
  for the first build, explicitly labeled as navigation evidence. This replaces
  the first build's requirement to prove consecutive playback of both Videos.
  Associate `pageReferrer` with destination `pagePath` on `videostarts` aggregates;
  validate both canonical Video mappings and record the mapping basis. Exclude
  ambiguous, unmapped, homepage, and self-referral pairs. Counts are associated
  destination starts, not unique navigations or proof of source playback. Do not
  chain aggregate edges into individual journeys. Existing ordered-history
  inputs retain their stricter qualification and meaning.
- Let the model explore the full authorized historical range through bounded,
  paginated queries. Bounded responses protect runtime memory; they do not
  impose an arbitrary short history window or mislabel truncated data as complete.
  A provider-declared availability boundary may establish a separately recorded
  usable interval; preserve the full requested range and label the unavailable
  prefix and gaps unknown. Complete pagination of that usable snapshot is
  distinct from complete source history. Transport/schema/pagination failures
  and unresolved response restrictions remain failures.
- Compute suitable video-level and navigation aggregates at the source.
  Raw user-level rows and identities do not enter prompts or the recommendation
  database. Native and historical measurements retain separate provenance;
  reconcile overlap before combining totals.
- Preserve query identity, range, cutoff, schema/measurement qualifications,
  result hashes/counts, mapping coverage, and bot-filter basis. Unknown historic
  bot evidence remains unknown. The live A/B metric uses its own human-visit policy.
- No warehouse exports, writer credentials, destination dataset, or export
  outbox are part of this experiment.

### Generation lifecycle and cost

- Persist a versioned generation manifest, compact source recommendation sets,
  English rationales/evidence, input provenance, model/prompt versions, build
  progress, and usage. Use existing runtime checkpoints and idempotent Admin
  writes; avoid a second broad raw-model-output log.
- A complete generation requires coverage accounting for every source in its
  declared build cohort, including explicit no-connection outcomes. Failed
  sources are not silently treated as valid empty results.
- Resume/retry must not duplicate accepted edges or cost accounting, allow a
  stale worker to complete a newer attempt, or publish partial content. Track
  real repeated provider usage when a retry incurs another charge.
- Make completed generations available atomically for private review; public
  activation remains a separate operation. Failed rebuilds preserve previous
  complete results. Reconsider old sources when refreshed inputs create new
  possible targets.
- Report actual model tokens and applicable pricing, warehouse query usage,
  elapsed time, coverage, and storage growth. Label estimated charges when final
  billing is unavailable. Do not confuse a fixture estimate with a completed
  first live catalog build.
- The October 8 subscription decision supersedes the original unrestricted
  API-spend assumption. Report subscription token usage and observed allowance
  separately from API charges; an unavailable dollar cost is not zero. Preserve
  normal coding allowance and pause safely when fresh usage admission fails.
  Do not purchase credits, redeem resets or resume paid API builds automatically.
  Keep per-request reliability and retention limits. Implement a repeatable
  refresh entry point; leave scheduling disabled until the user chooses cadence
  after reviewing the first-run report.

### Admin review and Watch serving

- Admin comparison selects a source Video, generation, and audio language;
  it shows incumbent versus experimental results, ordering, English reasons,
  evidence basis, and language coverage gaps. Private previews do not add
  public-experiment observations or alter assignment/serving state.
- Serve saved choices through the existing lazy Watch recommendation boundary,
  after the player shell is available. Preserve the layout and request deadline;
  do not add a page-render, hydration, or player-start dependency on generation.
- Compute shared recommendations once in English. Apply current publication,
  Watch visibility, playback, artwork, display-locale, and exact selected audio
  language checks when serving. Do not silently substitute another audio language.
- Choose up to six eligible saved targets according to the stored ranking and
  direct/alternative policy. A shorter row is valid. If neither direct choices
  nor alternatives survive, hide the row and expose the gap in Admin.
- Distinguish a valid empty result from missing/failed generation reads or
  technical delivery failure. On technical failure, attempt the incumbent
  within the existing total deadline. Preserve player availability if both fail.
  Failure recovery cannot bypass an authorization or publication restriction.
- Record assigned arm independently from actual strategy, generation, target
  identity, position, and fallback reason. Keep fallback visits in their
  original arm. Never call the model to fill a row or recover an error.

### Assignment, measurement, and evaluation

- Fix browser assignment 50/50 for an experiment, independently of source
  result count. Respect existing consent and measurement boundaries. The
  existing 24-hour session alone cannot provide full-experiment stickiness;
  use a versioned experiment assignment mechanism without viewer personalization.
- Freeze the experimental generation and control algorithm configuration for
  the first test. Ordinary control personalization continues. Freeze the
  source-catalog cohort; later source additions are outside this experiment
  in both arms. Current availability restrictions continue to apply.
- Define an eligible visit and its retry/navigation identity before measuring.
  Admit it independently of delivery success or card count. The bot/test/prefetch
  exclusion policy is server-owned and versioned, shared by both arms and both
  numerator/denominator. Inspect trusted edge signals; do not assume the
  existing user-agent heuristic proves human traffic.
- Primary CTR is distinct eligible visits with at least one accepted
  recommendation click divided by all eligible visits in the assigned arm.
  Valid empty results, errors, and fallbacks remain in the denominator. Multiple
  clicks or delivery retries within one visit do not add numerator contributions.
- Attribute clicks to server-issued item/request/visit bindings. A qualified
  impression is not required for an otherwise valid click to count in visit
  CTR. Reuse render/impression, selection, and playback evidence for diagnostics;
  report supported click paths and loss explicitly.
- Preserve card CTR as a separately defined impression-based diagnostic.
  Report unknown eligibility, unmatched evidence, fallback rates, and tracking
  failures; a lost event cannot be silently reconstructed as an observed click.
- Predeclare the stopping rule before live A/B activation using the measured
  human-visit baseline. It must specify the inference method, browser-cluster
  treatment of repeated visits, sample/duration requirements, detectable uplift,
  late-event cutoff, and measurement-health criteria. Thresholds are not invented
  in this spec and remain an explicit prelaunch decision.
  On October 7 the owner selected a one-month test followed by reevaluation.
  Implement one calendar month in UTC, preserving the start time and clamping
  the day to the target month's last day. At the cutoff, stop new experiment
  admissions and serve the incumbent; retain the fixed late-event cutoff and
  require manual reevaluation. This duration decision does not approve fixture
  statistical thresholds or automatic promotion.
- Store versioned evaluation revisions containing both arms' visit/click counts,
  CTR and uncertainty, exclusions, card CTR, fallback/measurement health,
  cohort/window, generation/control identity, stopping-rule version, and
  winner/inconclusive outcome. Invalid or insufficient evidence cannot certify
  a winner. Public reads cannot change an outcome or activate a generation.

### Storage and retention

- Build on the merged compact candidate traces, packed multi-card served
  snapshots, inline single-card snapshots, thin item rows, and compact internal
  exposure IDs. Preserve public event identities, mixed readers, immutable
  snapshots, and replay constraints. The current working checkout predates
  those changes; implementation must use a compatible integrated baseline.
- Save explanations and evidence once per generation, referencing existing
  versioned source evidence where possible. Retain only the small excerpts
  needed to preserve reviewable support when source references may disappear.
  Do not copy full transcripts, metadata, prompts, or raw warehouse records
  into every visit or workflow checkpoint.
- Preserve the request-owned 29-day raw lifecycle, descendant expiry, and
  existing sanitized audit policy. No implicit extension or shortening. Before
  a test can outlive raw evidence, implement compact aggregates sufficient for
  its chosen inference method, retry deduplication, and late-event policy.
- Bound superseded generations, failed-run diagnostics, and evaluation history.
  Protect active, test-pinned, and required rollback generations. Retain a
  durable compact result after raw events expire. Define retirement and
  reference lifetimes so cleanup cannot invalidate retained evidence.
- Measure native PostgreSQL bytes per visit, connection, and generation;
  retained footprint at measured traffic; heap/index/TOAST allocation; WAL;
  write/query latency; and build/rollback overlap. Include Mastra checkpoint
  and observability storage in the capacity review, not only Admin tables.
- Establish a storage budget against available Railway headroom before public
  activation. Prove loaded cleanup throughput with concurrent writes and
  realistic descendants. Distinguish reusable pages from recovered filesystem
  space. No destructive reclamation of existing production data is included.
- Check capacity before large build writes. If another generation cannot fit
  safely, stop it with an explicit capacity failure and preserve the previous
  complete generation; do not silently truncate accepted connections or consume
  protected operational headroom to finish it.

### Manual controls and reversibility

- Starting public A/B serving, promoting a reviewed generation, and rolling
  back are explicit authorized operations. First-test activation requires a
  complete generation, fixed cohort/control identity, stopping rule, usable
  measurement, and storage readiness; it does not require a winner report
  that can only exist after the test.
- Promotion after the test identifies the reviewed experiment, evaluation
  revision, and generation. Expose the same result and authorized controls to
  Admin and an authenticated agent without giving the content model authority
  to activate itself. Audit state changes and reject stale or incompatible targets.
- Retain an immediate incumbent rollback path. Disable the experiment before
  later removal, keep required readers while retained data exists, and respect
  the normal PR-to-main deployment flow. Build/evaluate/read operations never
  switch production traffic automatically.

## Testing Decisions

The user approved the testing boundaries and ticket breakdown. Product
requirements and the verification approach below are agreed.

- **Build-to-review boundary:** invoke the authenticated offline generation
  entry point against controlled catalog/warehouse/provider inputs, persist to
  native PostgreSQL through real Admin contracts, and inspect the result through
  the Admin read/preview surface. Assert observable complete/failed/resumed
  states, evidence, cost accounting, and independence from public serving.
- **Watch-to-result boundary:** exercise existing Web-to-Admin delivery and
  evidence contracts through persisted experiment state and evaluate through
  the authorized report surface. Assert displayed targets and exact visit-level
  counts rather than private helper calls. Stub provider/warehouse edges, not
  database transactions or the attribution rules under test.
- Prior art is the existing Admin delivery persistence/deadline tests,
  experiment evaluation and promotion tests, recommendation request-detail
  database tests, retention composition trials, compact snapshot parity tests,
  Mastra provider/ingest and Google analytics client tests, and Watch route and
  component lifecycle tests. Extend these established test styles.
- Use native PostgreSQL for migrations, atomic completion, idempotency,
  concurrent retries, immutable snapshots, referential retention, and measured
  physical storage. Mocks alone cannot establish database or capacity claims.
- Use a controlled catalog with one/many/no accepted connections, alternatives,
  non-English transcripts, metadata-only content, missing exposure, useful
  chapters/parent films, duplicates/Dubs, and changing audio availability.
- Exercise valid empty versus technical failure, both-failure player recovery,
  no online model calls, fixed browser assignment, excluded automation, repeated
  visits, duplicate events, multiple clicks, missing impressions, delayed events,
  frozen cohort/generation, and fallback accounting in the assigned arm.
- Cover clear winner and inconclusive fixtures, repeated-browser uncertainty,
  measurement-health failure, evidence expiry with unchanged retained counts,
  and proof that evaluation/read/build completion cannot activate serving.
- Browser coverage verifies Admin comparison and the real Watch row, navigation,
  language switching, and supported click paths. Capture page-load/resource or
  timing evidence; visual smoke alone does not prove unchanged loading behavior.
- Run a small authorized live model/warehouse smoke when credentials are
  available, followed by the separately observed first catalog build. Assess
  explanation/evidence quality explicitly; deterministic fixtures do not prove
  recommendation usefulness, and the live A/B result remains the deciding test.
- Run touched-scope formatting, type/lint, generated-contract drift, migration,
  service/database, and browser checks before implementation PR readiness. No
  live activation is performed merely to make tests pass.

## Out of Scope

- BigQuery export pipelines, warehouse writes, export outboxes, and a new
  analytics database.
- Viewer-personalized experimental generation, separate recommendation graphs
  per language, or request-time model inference.
- A mandatory six connections per source, exhaustive all-pairs judging, and
  invented filler when useful choices do not exist.
- Mobile/TV rollout, a new public recommendation layout, or public display of
  the Admin's detailed reasoning and transcript evidence.
- Automatic winner activation, an automatically chosen refresh frequency, or
  silently substituting a different model for the first build.
- Removing or redesigning the incumbent, shortening raw retention, or
  destructive cleanup of existing production records.
- Production deployment, public A/B activation, provisioning secrets, and
  messaging/creating the user's later activation chat as part of writing or
  implementing these specifications.

## Further Notes

- The user requested an orchestrator that creates GPT-6 Sol development chats
  to execute these tickets using Matt Pocock's implement, tdd, and code-review
  skills. Compound Engineering skills are prohibited for this effort, including
  indirect invocation by another skill. This workflow instruction overrides
  the repository's default Compound Engineering workflow; all other applicable
  repository conventions remain in effect. Sol is the development-chat model;
  the product's first generation model remains GPT-6 Astra.
- The agreed interview comprises Q1–Q23 and the subsequent explicit minimal
  storage and no-export constraints. The roadmap work remains in progress;
  completing this spec does not complete the experiment.
- Warehouse identification/access, actual model access, current human traffic,
  trusted bot signals, available volume headroom, and numeric stopping/capacity
  settings are implementation or prelaunch inputs. Develop with explicit
  fixtures while access is pending; do not invent a dataset or claim live proof.
- Implement against a baseline containing the merged storage work described
  by [#2429](https://github.com/JesusFilm/forge/pull/2429),
  [#2481](https://github.com/JesusFilm/forge/pull/2481),
  [#2479](https://github.com/JesusFilm/forge/pull/2479),
  [#2522](https://github.com/JesusFilm/forge/pull/2522), and the retention findings
  in [#2540](https://github.com/JesusFilm/forge/pull/2540) and
  [#2556](https://github.com/JesusFilm/forge/pull/2556). Fixture savings are not a
  forecast of production capacity; the separate retention-capacity work is an input.
- Publish the reviewed spec as the parent GitHub issue in JesusFilm/forge with
  the configured ready-for-agent label, then publish approved child tickets
  with native parent/blocking relationships. Keep the existing roadmap entry
  as the feature-level status record.
