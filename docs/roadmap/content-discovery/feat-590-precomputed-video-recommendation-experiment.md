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
generation model. Execution has started on current main through draft
[PR #2578](https://github.com/JesusFilm/forge/pull/2578); #2566 is assigned to a
separate GPT-6 Sol chat. The execution ledger is
`docs/plans/2026-10-05-precomputed-video-recommendation-status.md`. No ticket is
integrated yet, and public serving remains unchanged.

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

The first build has no user-imposed spend or runtime ceiling; report actual
cost and elapsed time so the user can then choose recurring frequency.
Include the user's historical GA warehouse, not just Admin's retained logs.
The user believes it is BigQuery; its identifiers, schema, and access remain
to be supplied/verified.
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
- Do not equate Codex model labels with verified application API model IDs.
- Historical recommendation exposure is observational evidence, not proof of
  causal uplift or a complete record of viewer preferences.
- Follow existing Video/Dub/Language identities and Admin consumer boundaries.
- Bound retained generations, failed-run diagnostics, and evaluation history;
  preserve active/test/rollback requirements and every accepted connection in
  retained generations. Do not use six displayed cards as a storage quota.
- Measure physical bytes and growth against Railway volume headroom before
  enabling traffic. Unrestricted first-run model spending does not imply
  unrestricted database storage.
- Preserve immutable served evidence and raw retention; avoid duplicate telemetry,
  redundant indexes, and full transcript/model-prompt copies in visit records.
  Destructive reclamation of existing data is outside this feature.
- Keep unrelated existing workspace edits intact.

## Verification

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
