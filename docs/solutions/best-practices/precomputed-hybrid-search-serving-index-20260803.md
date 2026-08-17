---
title: Precomputed serving indexes for multilingual hybrid search
date: 2026-08-03
last_updated: 2026-08-17
category: best-practices
module: apps/admin watch search
problem_type: best_practice
component: service_object
severity: high
applies_when:
  - Search combines lexical metadata, transcript vectors, and availability data
  - Request-time relational hydration threatens a one-second latency budget
  - A replacement backend needs an absolute multilingual quality gate before rollout
  - A reviewed candidate needs a reversible, evidence-bound production promotion
tags:
  [
    search,
    typesense,
    embeddings,
    multilingual,
    performance,
    indexing,
    promotion,
    baselines,
  ]
---

# Precomputed Serving Indexes For Multilingual Hybrid Search

## Context

Watch Search must preserve multilingual semantic recall while returning playable
video cards within one second. The PostgreSQL implementation can perform query
embedding, several retrieval lanes, and relational watchability hydration in a
single request. Datadog RUM showed that the broader production GraphQL endpoint
could exceed the browser's latency budget, but endpoint resource events could
not isolate GraphQL POST operations.

## Guidance

Evaluate a serving index with the complete corpus before replacing the default
backend. Separate records by both retrieval phase and fanout boundary:

- One catalog document per public video contains published lexical metadata,
  card fields, and compact availability slugs used during candidate ranking.
- One availability document per public video and language merges playable
  audio and subtitle state plus playback fields. Final hydration filters these
  documents to the target and ordered fallback languages.
- One transcript document per accepted native chunk contains the existing
  embedding, language, evidence text, video ID, start time, and an explicit
  `publiclyVisible` facet. Retain the broad semantic corpus; make every serving
  surface choose a visibility policy.
- Put locale-aware title and metadata fields in a small lexical collection; do
  not copy repeated titles/descriptions onto transcript chunks or insert
  vectorless catalog anchors into the vector collection. This lets routine
  metadata releases reuse the active HNSW index.
- Query embedding remains in the request path. Send title, metadata, and vector
  subqueries in one Typesense multi-search HTTP call, then combine their
  canonical-video ranks in Admin with explicit weights. Do not compare raw text
  and vector scores across collections or add sequential network requests.
- Group by a faceted canonical video identity with a small bounded group
  (`group_limit: 3` here). This suppresses repeated transcript chunks while
  retaining enough physical editions for hydration to select the best playable
  locale match. Emit only one result per canonical video after hydration.
- Hydrate the bounded candidate set from the catalog and availability indexes
  in one multi-search rather than joining availability tables during every
  search or transferring every language for each selected video.
- Build timestamped physical collections, validate every bulk-import row, then
  publish stable aliases. Restore prior aliases if a partial publication fails.
- Public Watch Search filters transcript retrieval with
  `publiclyVisible:=true`. A future AI surface must use a separate authorized
  policy rather than inheriting public or unrestricted access accidentally.
- Expose the experiment through an explicit API mode while leaving omitted or
  default mode on the established backend.

Benchmark both services against the same restored snapshot, with warmups,
alternating execution order, repeated multilingual exact and semantic queries,
and result-overlap reporting. Measure the complete service call, including query
embedding and language resolution, rather than only the search engine's internal
timer.

## Visibility And Service Boundaries

Corpus membership and frontend visibility are different decisions. For each
accepted native transcript vector, compute a visibility projection from the
current video, `noIndex`, and matching published-locale state:

```sql
v.deleted_at IS NULL
AND v.no_index = false
AND EXISTS (
  SELECT 1
  FROM video_locale vl
  WHERE vl.video_id = v.id
    AND vl.locale = vtc.language
    AND vl.status = 'published'
    AND vl.deleted_at IS NULL
)
```

Store that result as the faceted `publiclyVisible` field. Public semantic
retrieval must state its policy in the Typesense request:

```text
language:=[...] && publiclyVisible:=true
```

The vector lane keeps transcript language boundaries explicit:

```text
documentKind:=transcript && publiclyVisible:=true && language:=[...]
group_by=canonicalVideoId
group_limit=3
```

This lets publication and `noIndex` changes update a small projection without
regenerating valid embeddings. Hard-deleted transcript chunks still disappear
from the serving index when PostgreSQL removes the authoritative rows. Any AI
or administrative surface that later uses the broad corpus needs a separate,
explicit authorization and visibility policy.

Keep the lifecycle boundary equally explicit. PostgreSQL is authoritative,
Admin owns the public contract and orchestration, and Typesense is a private,
rebuildable projection. On Railway, the stateful process belongs in the
dedicated `@forge/admin/search` service with its own persistent volume. Do not
attach that volume to replicated `@forge/admin`; doing so couples API
availability and deploys to index memory, disk, and restart behavior.

## Private Candidate Generation Lifecycle

Treat a native-language search improvement as another immutable profile of the
same search service, not as a second search product. The current profile binds
to the four serving aliases. A candidate profile binds to one generation's
exact physical catalog, availability, lexical, and transcript collections and
rejects current aliases or collections owned by another generation
(`apps/admin/src/services/typesense-watch-search-profile.ts:28-43`,
`apps/admin/src/services/typesense-watch-search-profile.ts:111-180`). Freeze the
current aliases to physical collections before comparison so an alias move
cannot change the selected baseline after it is resolved
(`apps/admin/src/services/typesense-watch-search-profile.ts:205-230`).

Deployment, private evaluation, and public serving are separate controls:

- `EVALUATION` names the candidate used by the private Admin comparison.
- `SERVING` authorizes a generation for a later public selection.
- `WATCH_SEARCH_TYPESENSE_PROFILE` is the server-owned selector beneath
  `MODERN`; it defaults to `CURRENT`, while the comparison flag defaults off
  (`apps/admin/src/config/env.ts:672-686`).
- Candidate serving requires the selector and `SERVING` pointer to name the
  same generation, then revalidates the exact application revision, ranking
  revision, transcript projection, current physical bindings, and evaluation
  revision. The authorizing qualification is either an automatic `PASSED`
  record or a truthful `OPERATOR_ACCEPTED` record for the same evidence-bound
  identity (`apps/admin/src/services/typesense-watch-search-candidate-generation.ts:1430-1487`).

The application revision is the physical Candidate-collection compatibility
identity, not the Admin deployment SHA. It stays stable across unrelated
deployments and application-only ranking changes, and changes only when the
schema, projection, or retrieval-field contract requires rebuilt collections.
Ranking behavior has a separate qualification revision, so a new ranker must
be requalified but can reuse compatible physical collections
(`apps/admin/src/services/typesense-watch-search-candidate-identity.ts:3-22`).
Using a full deployment identity here makes a healthy generation incompatible
after unrelated Admin changes; see
[Keep Watch search Candidate generations compatible across unrelated Admin deploys](../integration-issues/watch-search-candidate-generation-stable-application-revision.md).

The private page at `/dashboard/search/compare` runs one normalized query
against frozen current and candidate profiles. Each side records its own result
or error, so candidate failure cannot hide the current result. Candidate work
is separately admitted through a renewable deployment-wide lease and an actor
rate limit; the current side still runs when candidate setup or admission fails
(`apps/admin/src/services/typesense-watch-search-comparison.service.ts:166-257`).
The public browser and GraphQL contract cannot name a generation, so publishing
a candidate or moving `EVALUATION` does not add candidate work to a public
request.

For native-language recall, do not turn a script guess into a lexical hard
filter. Short strings and shared scripts often support several languages. The
candidate queries every title and metadata field in its immutable lexical
manifest and allows the semantic lane to search globally
(`apps/admin/src/services/typesense-watch-search.service.ts:1157-1267`). Existing
slugs, BCP-47 labels, localized language names, explicit target, script,
browser, route, and current-Watch context still build at most three language
candidates as ranking and playback evidence, not admission filters
(`apps/admin/src/services/typesense-watch-search-query-plan.ts:12-24`,
`apps/admin/src/services/typesense-watch-search-query-plan.ts:337-360`). This
keeps recall global without multiplying requests by every supported language.

Qualification belongs to one exact identity: generation, application
revision, transcript physical collection and projection revision, qrels
revision, frozen current bindings, and candidate bindings
(`apps/admin/src/scripts/benchmark-watch-search-candidate.ts:40-48`). The paired
benchmark fails closed on identity drift, errors, degradation, incomplete
quotas, or lease loss. It rejects any p50, p95, or p99 latency regression and
caps retrieval calls, logical subsearches, query fields, query bytes, request
bytes, candidate windows, hydration, response bytes, and retries
(`apps/admin/src/scripts/benchmark-watch-search-candidate.ts:332-399`,
`apps/admin/src/scripts/benchmark-watch-search-candidate.ts:402-465`). Passing
evidence must also bind the same qrels and current-baseline identity before it
can be stored or used for serving promotion
(`apps/admin/src/services/typesense-watch-search-candidate-generation.ts:130-175`,
`apps/admin/src/services/typesense-watch-search-candidate-generation.ts:739-790`).

Coordinate mutation and evaluation in the database, not by operator timing.
Current publication holds one PostgreSQL advisory lock across the external
Typesense operation. Lease acquisition, lease renewal, and `SERVING` promotion
probe that same lock transactionally; current publication also refuses active
candidate leases or a serving candidate
(`apps/admin/src/services/typesense-watch-search-candidate-generation.ts:799-912`,
`apps/admin/src/services/typesense-watch-search-candidate-generation.ts:1157-1205`,
`apps/admin/src/services/typesense-watch-search-candidate-generation.ts:1207-1275`).
Candidate runtime, comparison, and qualification require a dedicated search
key, while publication and deletion use a separate operator key.

Rollback to `CURRENT` does not rebuild or delete anything. Candidate service
resolution is coalesced and cached for at most 30 seconds, with immediate
eviction after rejection (`apps/admin/src/services/index.ts:101-133`). The
operator must return traffic to current, disable comparison, and then wait at
least 35 seconds before removal
(`docs/plans/2026-08-09-001-feat-native-language-watch-search-candidate-plan.md:351`).
Retirement then atomically rejects serving or leased
generations, clears the exact `EVALUATION` pointer, and moves the generation to
`RETIRING` before deleting only its owned catalog, availability, and lexical
collections with persisted progress
(`apps/admin/src/services/typesense-watch-search-candidate-generation.ts:941-1045`,
`apps/admin/src/scripts/index-typesense-watch-search-candidate.ts:434-528`). The
shared transcript projection and current aliases are never retirement targets.

## Why This Matters

Metadata-only search is fast but loses generic intent queries that AI clients
and people depend on. Moving vectors into a purpose-built index keeps semantic
recall while removing repeated relational hydration from the hot path. A mode on
the existing GraphQL field preserves contract parity and makes measurements
harder to accidentally run against the wrong implementation.

The full-data run is essential. A viewer-safe final-result set can be much
smaller than the semantic evidence corpus searched before the visibility gate.
Capacity the serving index from the broad corpus, then verify that the public
filter reproduces final-result safety. This validates vector dimensions,
multilingual handling, memory growth, import behavior, visibility gates, and
ranking overlap in ways a small projection cannot.

## When To Apply

- Search request paths repeatedly join stable display or availability metadata.
- A semantic index already exists, but ranking still needs lexical exactness.
- Candidate hydration dominates latency after retrieval.
- A bounded result count still has an unbounded payload because each result
  embeds a high-fanout locale, dub, subtitle, or entitlement array.
- An architecture change needs evidence without changing production traffic.

## Examples

On the 2026-08-03 first-pass Watch Search projection, Typesense indexed 1,107
viewer-visible videos and 17,118 public transcript vectors. Five warmed runs
across five multilingual cases measured a 158 ms p50 and 257 ms p95 end to end.
French `communion` returned `La communion des croyants` first with target audio
at a 168 ms p95 and 0.80 top-ten overlap with PostgreSQL. A later production
audit found 280,107 accepted native transcript vectors, proving that the first
projection was suitable for visibility testing but not broad-corpus capacity
planning.

The result does not prove Typesense is universally faster: local PostgreSQL was
119 ms p95 in the same run. It proves the precomputed hybrid architecture can
retain semantic retrieval. Production placement, synchronization, relevance,
and capacity require a separate rollout decision. On Railway, run Typesense as
the dedicated `@forge/admin/search` service: Admin is replicated and stateless,
while the serving index requires a persistent volume.

The broad-corpus vector memory term is:

```text
7 bytes × 1,536 dimensions × 280,107 records
= 3,011,710,464 bytes
= 2.80 GiB
```

That is not total process RSS. Facets, allocator overhead, working memory, and
two simultaneous generations during an atomic rebuild require additional
headroom. The deployed single-node shadow service has a 16 GiB memory limit.
The full rebuild must still replace planning estimates with measured resident
memory, process RSS, peak import memory, and disk use.

A later production trace exposed an important refinement: bounding final
hydration to 20 catalog documents was insufficient when those documents still
contained every audio and subtitle option. A broad result page transferred
about 994 KB; Typesense reported roughly 6 ms of engine work while private wall
time was about 53 ms. PostgreSQL DEFAULT was faster because its SQL already
projected only target/fallback rows. Normalizing video/language availability
restores that projection boundary without moving hydration back to PostgreSQL.

Traffic rollback and index rollback stay independent. Omitted mode and
`DEFAULT` continue through PostgreSQL, so disabling Modern restores the public
path without changing schema or deleting Typesense data. A bad index generation
can separately move its aliases or active-generation pointer back to the last
healthy collections.

## Separate Lexical And Semantic Lane Refinement

The first implementation queried the catalog and transcript collections in
parallel and merged up to 40 chunks in Admin. That deduplicated too late: many
chunks from one video could consume the semantic candidate budget. It also
made Admin approximate ranking that Typesense already supports.

The refined serving contract keeps `watch_search_transcripts` vector-only and
adds `watch_search_lexical`. Vector documents retain the exact embeddings read
from PostgreSQL; the indexer never calls an embedding provider. A manual schema
rebuild is required only when the active transcript alias lacks canonical or
visibility facets. Routine releases reuse the vector/HNSW collection and build
catalog, availability, and lexical generations under the existing PostgreSQL
advisory lock. The request uses three subqueries in one HTTP call, fixed vector
`k:80`, default HNSW effort, canonical grouping, and deterministic 56/14/30
weighted RRF in Admin. Offset pagination remains bounded and does not repeat
sequential Typesense calls. Production latency and absolute eval gates must be
measured before changing these controls.

If query embedding misses its deadline, Admin sends title and metadata lanes in
one request and marks the semantic lanes degraded. If the lexical alias is
absent during code-first deployment, Admin reuses the already-created query
embedding and falls back to the previous bounded catalog/vector path. This
provides a deploy-order safety net without creating document embeddings or
paying for a second query embedding.

## Query Embedding Cache Evidence

Optimizing retrieval does not remove the query embedding from the hybrid
critical path. Repeated queries therefore use two bounded cache layers in
`apps/admin/src/services/watch-search.service.ts`:

- a 256-entry, one-hour process L1 removes PostgreSQL and provider work from a
  hot request;
- the existing PostgreSQL cache remains the shared L2 across Admin processes;
- identical concurrent misses coalesce so one provider request supplies every
  waiter;
- provider, model, dimensions, and normalized query remain part of the cache
  identity; returned vectors are cloned and dimension-checked before use.

The embedding lane reports `cache_l1_hit`, `cache_l2_hit`,
`cache_coalesced`, `cache_miss`, or `cache_l2_error`. Production latency reports
must use those outcomes as the cache authority. The first occurrence in a probe
process is not necessarily a cold miss because production traffic or L2 may
already have populated the value. Report first-seen and repeated samples
separately, but never label the former cold without the lane evidence.

## Production Relevance Tuning

Tune one native Typesense control at a time and evaluate the exact deployed
revision against a frozen baseline. The request contract is pinned in
`apps/admin/src/services/typesense-watch-search.service.ts:266-302` and its
colocated test. It remains one grouped hybrid request with the existing query
embedding; these query-time changes do not rebuild the index or create corpus
embeddings.

The fixed 100-query production suite on 2026-08-05 produced:

| Experiment                                          | PR                                                    | Same top result | Empty lists | Top-ten Jaccard | Decision                          |
| --------------------------------------------------- | ----------------------------------------------------- | --------------: | ----------: | --------------: | --------------------------------- |
| Initial native hybrid                               | predecessor                                           |             42% |          29 |           0.339 | Diagnose                          |
| Remove the 0.5 vector-distance threshold            | [#1842](https://github.com/JesusFilm/forge/pull/1842) |             42% |          30 |           0.312 | Reject                            |
| Restore threshold; enable controlled token dropping | [#1843](https://github.com/JesusFilm/forge/pull/1843) |             44% |           6 |           0.392 | Retain                            |
| Enable hybrid reranking                             | [#1844](https://github.com/JesusFilm/forge/pull/1844) |             44% |           6 |           0.392 | Reject: no relevance gain, slower |
| Reduce vector `alpha` from 0.3 to 0.1               | [#1845](https://github.com/JesusFilm/forge/pull/1845) |             44% |           6 |          0.3917 | Reject: no top-one gain           |
| Restore `alpha: 0.3`                                | [#1846](https://github.com/JesusFilm/forge/pull/1846) |       Not rerun |   Not rerun |       Not rerun | Restore measured-best config      |

Controlled token dropping was the only tested parameter that materially
recovered recall: empty result sets fell from 29 to 6 and product-title empties
fell to zero without adding another Typesense request. Removing the distance
threshold admitted weaker neighbors without recovering recall. Hybrid
reranking left every deterministic relevance metric unchanged while increasing
latency, and lower vector alpha changed none of the 100 top results relative to
the retained candidate.

Parity metrics are necessary but not sufficient. Same-top-result and Jaccard
measure resemblance to the established backend, not absolute intent quality.
The Mastra comparison therefore judges each result list in both orders
(`apps/mastra/src/services/offline-search-eval/runner.ts:597-617`) and reports
order-sensitive verdicts as disagreements
(`apps/mastra/src/services/offline-search-eval/report.ts:42-64`). For the #1845
candidate, that judge returned 24 Modern wins, 30 losses, 8 ties, and 38
disagreements with no judge or search failures. The main slices were:

| Query slice   | Wins | Losses | Ties | Disagreements |
| ------------- | ---: | -----: | ---: | ------------: |
| Product title |    2 |     10 |    0 |            10 |
| Scene-like    |    2 |      8 |    1 |             4 |
| Multilingual  |   11 |      2 |    6 |             6 |

This did not establish baseline-or-better public relevance. Same-top, Jaccard,
and bidirectional pairwise preference now remain diagnostics only: `DEFAULT` is
a rollback backend, not the definition of correctness.

The default automatic promotion authority is the versioned 104-case
`public-watch-absolute/v2` corpus in
`apps/mastra/src/services/offline-search-eval/absolute-query-set.ts`. Development
queries may be rerun during tuning; held-out cases run only after the candidate
is frozen. The gate requires reviewed canonical-video qrels, overall NDCG@10 at
least 0.80, MRR at least 0.85, success@10 at least 0.90, product-title
success@1 at least 0.90, semantic-intent success@10 at least 0.80,
multilingual success@10 at least 0.90, honest no-result accuracy of 1.00,
language correctness of 1.00, zero canonical duplicates, at least 85%
pointwise-useful judgments, at most 5% unacceptable judgments, and full
round-trip p95 at most 550 ms. The separate production probe still requires
server p95 at most 250 ms, exactly 100 accepted internal requests plus 100
GraphQL requests, analytics correlation IDs, and zero unexplained degradation.

An unreviewed run fails closed. The repository relevance set starts empty;
Mastra accepts a strict versioned reviewed set through the real workflow input.
Held-out reports also name the exact Admin revision and the physical catalog,
availability, lexical, and transcript collections, reject missing or mixed
observed revisions, record the pointwise judge provider/model/cost, and require
named operator review. Strict artifact schemas prevent arbitrary observations
or invented metric shapes from being persisted as release evidence.

An authorized operator may accept a measured candidate that misses those
automatic thresholds, but that decision is a separate status rather than a
synthetic pass. `OPERATOR_ACCEPTED` requires at least one explicitly waived
`FAIL` or `NOT_RUN` gate and preserves the measured relevance, latency,
limitations, reviewer decision, and exact evidence-bundle identity
(`apps/admin/src/services/typesense-watch-search-candidate-qualification.ts:260-330`).
The operator-acceptance evaluation revision embeds the supplied decision ID and
participates in the serving digest. Giving every acceptance decision a new
decision ID gives it a distinct observable serving identity
(`apps/admin/src/services/typesense-watch-search-candidate-evaluation.service.ts:173-216`).

The next experiments should measure how many distinct canonical videos survive
native retrieval before hydration, especially for product-title and scene-like
losses. Do not assume that increasing `k` or HNSW `ef` fixes the problem: the
earlier PostgreSQL HNSW prototype showed how repeated chunks from one long video
can consume an approximate-neighbor window before per-video collapse. Record
distinct-video counts and result-list truncation before widening either knob.

## Production Proof And Guarded Promotion

The production build imported all 280,107 accepted transcript vectors without
calling an embedding provider. Typesense reused the embeddings already stored
in PostgreSQL and built the HNSW serving projection from those values. After the
temporary previous transcript generation was removed, the single-node
`@forge/admin/search` service settled at approximately 4.69 GiB RSS and had
peaked at approximately 5.34 GiB against its 16 GiB limit. Capacity estimates
must therefore distinguish steady-state RSS from the temporary two-generation
rebuild peak.

The production probe added in [#1864](https://github.com/JesusFilm/forge/pull/1864)
then completed 100 accepted internal MODERN requests and 100 accepted GraphQL
MODERN requests. All 200 requests carried analytics correlation IDs and none
reported degradation:

| Path           | Server p50 | Server p95 | Full round-trip p50 | Full round-trip p95 |
| -------------- | ---------: | ---------: | ------------------: | ------------------: |
| Admin internal |   90.30 ms |  208.17 ms |           355.73 ms |           881.88 ms |
| Public GraphQL |   87.48 ms |  193.69 ms |           341.50 ms |           526.43 ms |

This is evidence that the server-side MODERN target is achievable; it is not
evidence that Auckland network latency has disappeared. Report the Admin timer
and caller round trip separately, and do not let the slower network series
invalidate a server optimization or let the faster server series conceal a
poor user round trip.

An 83-case development judge pass also demonstrated why promotion evidence
cannot be reduced to agreement with DEFAULT. MODERN produced useful-or-excellent
lists for 49 cases (59.0%) versus 44 (53.0%) for DEFAULT, and unacceptable lists
for 14 cases (16.9%) versus 15 (18.1%). MODERN also reduced no-result responses,
but its language-correctness rate was lower. The reviewed qrel set was still
empty, so NDCG, MRR, and the formal absolute release gate remained unavailable.
Treat these development judgments as directional evidence for a guarded public
rollout, not as a substitute for reviewed qrels.

Promotion should keep three controls independent:

- Web chooses the primary Search Pipeline Mode explicitly; it must not depend
  on the GraphQL field's omitted-mode compatibility default.
- DEFAULT can run as bounded, best-effort shadow work after the MODERN response
  is ready. Shadow failure or queue saturation must never change the public
  response or add to its latency.
- Operators can restore DEFAULT as primary through configuration without
  deleting Typesense data or moving collection aliases. Traffic rollback and
  index rollback remain separate operations.

Authenticated fleet rollout adds a fourth, default-off control. Canonical Web
can verify the configured primary while `WATCH_SEARCH_FLEET_PRIMARY_ENABLED`
remains false. Only after that smoke check should authenticated fleet callers
that omitted `mode` inherit the primary; explicit modes and non-fleet callers
retain their existing behavior (`apps/admin/src/config/env.ts:695-704`,
`apps/admin/src/graphql/queries/watch-search.ts:55-81`).

The concrete Web controls are `WATCH_SEARCH_PRIMARY_MODE` (production defaults
to `MODERN`, non-production to `DEFAULT`) and
`WATCH_SEARCH_DEFAULT_SHADOW_ENABLED`. Admin accepts the shadow request only
from its non-fleet Web consumer bearer, starts it through Next.js `after()`, and
bounds it to one concurrent execution and 64 reserved jobs per process. Primary
and shadow Search Traces share a request ID but use explicit roles; product
analytics, long-lived aggregate counters, and eval sampling exclude shadow
traces so comparisons do not double-count users or query intent.

## Audited Candidate Promotion And Serving-Bound Baselines

Promotion is an authorization sequence, not one environment-variable flip:

1. Deploy the support code with `WATCH_SEARCH_TYPESENSE_PROFILE=CURRENT` and
   `WATCH_SEARCH_FLEET_PRIMARY_ENABLED=false`.
2. Record either an exact automatic `PASSED` qualification or a self-contained
   `OPERATOR_ACCEPTED` bundle. Keep the automatic result unchanged when gates
   were waived.
3. Compare-and-set the same generation onto the `SERVING` pointer. The pin
   re-reads Current physical bindings under the publication lock and requires
   the exact status, application, ranking, transcript, evaluation, reviewer,
   operator, digest, and optional byte-length evidence
   (`apps/admin/src/services/typesense-watch-search-candidate-generation.ts:1410-1501`).
4. Select `CANDIDATE:<generation>`, wait for the serving-profile cache, and run
   the pre-registered multilingual exact-title and semantic smoke matrix on
   canonical Web. Restore `CURRENT` immediately on identity, relevance,
   latency, degradation, error, or capacity failure.
5. Enable omitted-mode authenticated fleet routing only after Web passes.
   Keep explicit-mode controls intact.

Post-launch evidence must measure the generation and revision currently pinned
by the versioned Serving pointer, not the independently movable Evaluation
pointer. The dedicated authenticated route accepts only `modern` and fixes its
source to `SERVING`
(`apps/admin/src/app/api/internal/search-eval/serving-search/route.ts:13-23`).
Mastra rejects captures with missing or mixed server revisions before writing
anything (`apps/mastra/src/services/offline-search-eval/runner.ts:401-422`).
The baseline and report are validated before writing. If the baseline write
fails, the store attempts to restore or remove the report and surfaces an error
if that compensating rollback also fails
(`apps/mastra/src/services/offline-search-eval/artifacts.ts:647-694`).

Preserve and export the old `seed-baseline`, capture a dated baseline for the
exact serving revision, rerun the accepted query set, and compare relevance and
latency with the accepted evidence. Replace `seed-baseline` only if the new
production measurements still support the same decision. A material drift
requires a new review decision rather than silently redefining the baseline.

Normal rollback disables fleet inheritance and returns the Typesense profile to
`CURRENT`; emergency rollback can separately return the primary mode to
PostgreSQL `DEFAULT`. Neither operation deletes Candidate collections, moves
the Serving pointer, or rewrites baseline history.

## Related

- [Typesense Watch Search local comparison](../../operations/typesense-watch-search-local.md)
- [Typesense Watch Search production readiness](../../operations/typesense-watch-search-production-readiness.md)
- [Admin Watch Search production rollout checklist](admin-watch-search-production-rollout-20260720.md)
- [Canonical language and exact-title ranking](../logic-errors/canonical-language-boundaries-and-lexicographic-search-ranking.md)
- [Result-preserving search latency optimization](../performance-issues/admin-search-result-preserving-latency-optimization.md)
- [Admin semantic HNSW prototype parity gate](../performance-issues/admin-semantic-hnsw-prototype-parity-gate.md)
- [Mastra offline search eval orchestration](../architecture-patterns/mastra-offline-search-eval-orchestration-boundary-pattern.md)
- [Mastra seed-baseline portability](../architecture-patterns/mastra-seed-baseline-portability-pattern.md)
- [Global exact-title recall with localized tokenizers](../architecture-patterns/typesense-global-exact-title-recall-with-localized-tokenizers.md)
- [Candidate application revision stability](../integration-issues/watch-search-candidate-generation-stable-application-revision.md)
- [Internal diagnostic search modes need mode-aware eval identity](../architecture-patterns/internal-diagnostic-search-modes-need-mode-aware-eval-identity.md)
- [Atomic database claim instead of split check-and-write](../database-issues/db-lock-must-be-atomic-update-not-select-for-update.md)
- [Async single-flight slot release hazards](../design-patterns/async-single-flight-slot-release-hazards.md)
- [Producer-consumer report file contract](producer-consumer-report-file-contract-pattern-20260506.md)
- [Universal multilingual Watch Search roadmap](../../roadmap/platform/feat-254-watch-universal-multilingual-search.md)
