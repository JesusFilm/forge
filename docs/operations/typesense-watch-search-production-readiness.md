# Typesense Watch Search Production Readiness

This report evaluates the parallel `MODERN` Watch Search backend and defines a
reversible frontend promotion. The GraphQL compatibility default remains the
PostgreSQL `DEFAULT` backend. The production browser omits mode selection;
Admin recognizes the canonical Web origin and applies `MODERN` plus a bounded
`DEFAULT` shadow on every request after the rollout evidence below passes.
Admin remains the public search gateway and owns language interpretation,
query embeddings, visibility, watchability, analytics, degradation, and the
GraphQL contract. Typesense is a private serving index for lexical and semantic
retrieval.

## Decision

The private, single-node `@forge/admin/search` service has now passed the scoped
capacity and production-latency gates for a guarded frontend promotion. The
promotion still ships through the normal reviewed PR-to-main path; it is not a
direct production mutation from a workstation. The evidence is:

1. The active transcript generation contains 280,107 existing vectors. Routine
   catalog, availability, and lexical releases reuse it; they do not call an
   embedding provider or rebuild HNSW.
2. The single active generation settles at approximately 4.69 GiB RSS and
   peaked at approximately 5.34 GiB on the 16 GiB service after stale
   generations were retired.
3. The production 100-request GraphQL probe measured MODERN server p50 87.48 ms
   and p95 193.69 ms, with full-round-trip p50 341.50 ms and p95 526.43 ms.
   A separate 100-request internal probe measured server p50 90.30 ms and p95
   208.17 ms. All 200 requests were trace-correlated and none degraded.
4. The 83-case directional judge found more useful-or-excellent MODERN lists
   (49 versus 44) and fewer unacceptable lists (14 versus 15) than DEFAULT.
   The reviewed qrel set is still empty, so this supports guarded promotion and
   shadow observation, not declaration of a new absolute relevance baseline.

Production Web must reach `MODERN` through Admin's canonical-browser policy
rather than by changing the public GraphQL compatibility default. Omitted mode
continues to mean PostgreSQL `DEFAULT` for every noncanonical caller. The
browser receives neither a Typesense endpoint nor a write/admin key. Local,
preview, API, AI-agent, and other callers whose `Origin` is not the canonical
Web origin retain the omitted-mode `DEFAULT` behavior. Admin defaults canonical
production Web requests to MODERN unless its service environment explicitly
sets `WATCH_SEARCH_PRIMARY_MODE=DEFAULT`.

## Comparison And Corpus Status

The 2026-08-03 viewer-safe experiment contained 1,107 catalog documents and
17,118 transcript vectors. Its five-run warmed baseline was:

| Backend            |    p50 |    p95 |
| ------------------ | -----: | -----: |
| PostgreSQL         |  79 ms | 119 ms |
| Typesense `MODERN` | 158 ms | 257 ms |

That first transcript projection was too narrow for the intended serving
architecture. A read-only production audit on 2026-08-04 found 280,107 accepted
native 1,536-dimension transcript vectors and 1,175 viewer-visible catalog
documents. The transcript collection retains the broad corpus and stores
faceted `publiclyVisible` and canonical identity on every vector. Localized
title and metadata retrieval now belongs to a separate small lexical
collection, so catalog releases do not patch or duplicate text across
transcript chunks. Public Watch Search always filters
`publiclyVisible:=true`; a future authorized AI surface can apply a different
explicit policy without rebuilding a metadata-only index.

Do not run the production-sized corpus on a developer workstation. After the
normal PR merge, run the initial broad rebuild inside the isolated
`@forge/admin/search` shadow service. The no-argument index command detects the
missing transcript alias and bootstraps it. Later routine releases reuse that
physical transcript collection and rebuild only catalog, availability, and
localized lexical projections.
Reuse is allowed only when the active transcript schema contains
`videoEditionId`. If it does not, the index command fails before publishing any
alias and requires the explicit `--rebuild-transcripts` operation below. Do not
override that guard: a mixed generation cannot preserve edition-scoped
subtitle routing.
Record the physical collection names, catalog count, availability count,
transcript count, public transcript count, estimated vector bytes, per-case
rankings, overlap, lane timings, disk use, and Typesense `/metrics.json` before
and after the build. Never persist the Railway token or rendered database URL
in the repository, logs, or benchmark output.

An operator explicitly starts a new vector generation when transcript data,
visibility, model dimensions, or schema changes require it:

```bash
pnpm --filter @forge/admin index:typesense-watch-search -- \
  --rebuild-transcripts
```

The completed stats must say `transcriptReused: false` for that operation and
`transcriptReused: true` for an ordinary release refresh. Unknown or misspelled
arguments fail before any index work begins.

## `JESUS` Ranking Review

The low 0.053 top-ten overlap had a deterministic cause in the first Modern
implementation:

- PostgreSQL distinguishes a normalized whole-title match from a title that
  merely contains all query tokens. It ranks the whole title first.
- Modern gave both cases the same exact evidence boost and capped their total
  score at 1.0. Ties then fell through to document ID ordering.
- Modern only requested about 41 lexical candidates for the default page,
  while PostgreSQL's watchability reranker evaluates at least 100.

Modern now sends three logical searches in one Typesense multi-search request:
a locale-aware title lane, a locale-aware metadata lane, and a grouped
transcript-vector lane with fixed `k:80` and the existing distance threshold.
Admin combines canonical-video ranks with deterministic weighted RRF: 56%
title, 14% metadata, and 30% semantic evidence. A normalized whole-title match
remains first-order precedence. `group_by=canonicalVideoId` and
`group_limit:3` prevent repeated chunks and language/aspect variants from
consuming the result page while retaining enough members for target-audio,
subtitle, and fallback hydration.

The private Candidate evaluation profile adds one global exact-title-key
subsearch to that same first multi-search request. Current remains at three
logical searches in the first request; Candidate must report exactly one more
logical subsearch overall and the same number of HTTP retrieval calls. The
exact path is not qualified merely because the request is batched: all latency,
payload, and capacity gates in the native-language section below still apply.

Semantic retrieval has not been removed. Modern still generates one query
embedding and supplies it to the transcript-vector lane. If embedding
generation misses its deadline, the same multi-search contains only title and
metadata lanes. Lexical requests retain Typesense's default field validation,
so an absent alias or pre-language-identity schema fails closed during a
code-first deployment. Admin then reuses the same embedding for the bounded
compatibility path. Embedding and Typesense retrieval remain separate analytics
lanes.

## Production Latency Investigation

### Populations and limitations

The evidence comes from three different sampled populations and must not be
treated as one exact distribution:

- Datadog APM retained 1,532
  `service:forge-admin resource_name:graphql.query.WatchSearch` spans in the
  seven days ending 2026-08-04. They show 2.03 s p50 and 5.41 s p95.
- Structured `Forge Web Watch Search` response logs contain 5,181 initial
  searches in the window, but the last matching log is 2026-08-02 even though
  APM continues. Their service latency is 646 ms p50 and 5.38 s p95.
- The earlier RUM sample was endpoint-wide Admin GraphQL traffic. RUM omits the
  GraphQL operation name and POST body, so its 1.30 s p50 and 24.82 s p95 are
  context, not Watch Search measurements.

### Stage attribution

The structured lane population has 5,022 parseable lane records:

| Stage                       |                                      p50 |                                p95 | Interpretation                                                                                                                                                                                                                                                                     |
| --------------------------- | ---------------------------------------: | ---------------------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Query embedding             |                                   478 ms |                           4,965 ms | Main degraded-path cost; the old timeout budget was about 5 s.                                                                                                                                                                                                                     |
| Language resolution         |                           1–4 ms healthy |        3,379 ms sampled slow trace | Normally small; a simple language query becomes slow during database congestion.                                                                                                                                                                                                   |
| Metadata retrieval          |                                    43 ms |                             179 ms | PostgreSQL keyword/trigram retrieval in the logged `DEFAULT` population.                                                                                                                                                                                                           |
| Semantic retrieval          |                                    70 ms |                             252 ms | PostgreSQL pgvector retrieval after an embedding exists.                                                                                                                                                                                                                           |
| Exact-title retrieval       |                                    10 ms |                              81 ms | Exact lexical lane.                                                                                                                                                                                                                                                                |
| Metadata watchability       |                                    30 ms |                             125 ms | Candidate visibility/playability hydration.                                                                                                                                                                                                                                        |
| Exact watchability          |                                     0 ms |                              93 ms | Zero represents skipped lanes without exact candidates.                                                                                                                                                                                                                            |
| Semantic watchability       |                                    19 ms |                              65 ms | Semantic candidate visibility/playability hydration.                                                                                                                                                                                                                               |
| Analytics trace persistence |                     off the request path | bounded queue, one write at a time | The resolver enqueues the normal Watch Search trace after search and registers accepted work with Next.js `after()`. Slow writes no longer delay GraphQL or multiply database-pool pressure; the queue rejects excess work after 256 pending records and emits `trace_queue_full`. |
| Public Web-to-Admin hop     | about 1,014 ms in a recent healthy trace |    not available as a distribution | Time before the Admin request began; includes public routing/proxy/network or queueing that current spans cannot split further.                                                                                                                                                    |
| Admin-to-Typesense network  |                        local only so far |       production evidence required | Must use private same-region networking and be measured under load.                                                                                                                                                                                                                |

Two traces explain the large tail:

1. An older 5.37 s Watch Search trace timed out query embedding. The language
   lookup spent 294 ms waiting for a Prisma connection and about 10 ms in SQL,
   but the approximately 5 s embedding deadline dominated the request.
2. A recent 6.41 s trace had negligible connection acquisition (roughly
   0.003–0.008 ms) but 1.5–3.5 s SQL spans, including a simple language lookup
   and the trigram query. This is database/dependency execution congestion, not
   connection-pool queueing.

A recent healthy trace separates another problem: Admin completed Watch Search
in about 370 ms, including a 252 ms Fireworks embedding and an 82 ms semantic
PostgreSQL query, while Forge Web's enclosing request took 1.389 s. Roughly
1.014 s elapsed before Admin began. Moving retrieval to Typesense could remove
tens of milliseconds from this trace, but cannot make the full request sub-200
ms while either the 252 ms embedding or the public hop remains.

The local benchmark invokes each search service directly. It therefore excludes
the Web-to-Admin hop and GraphQL serialization. Historical production APM also
included an awaited trace write: a sampled slow trace reached the sink's 250 ms
deadline while the database write continued after the resolver returned. Watch
Search now submits the same analytics payload to a bounded, single-writer queue,
so trace persistence is not part of response latency and timed-out writes cannot
silently fan out against the database pool. Each accepted write is retained by
Next.js `after()` after the response flushes, with a guarded fallback for CLI
and test contexts that do not have a request lifecycle. Production load tests
must monitor queue-full warnings and compare accepted request IDs with persisted
traces.

Language identity, target/fallback, and evidence-locale reads use bounded
per-Prisma-client caches with a five-minute TTL and in-flight coalescing. A
language or fallback edit can therefore take up to five minutes to reach every
warm Admin replica; a restart clears the cache immediately. The target/evidence
caches hold at most 4,096 entries each and the identity-signal cache holds at
most 2,048 entries, so arbitrary query text cannot grow them without bound.

### Confirmed Modern hydration regression

A paired production trace on the current compact-catalog generation completed
`DEFAULT` GraphQL in 156.5 ms and `MODERN` in 213.7 ms. MODERN's final catalog
hydration occupied 92.2 ms on the serial critical path. No correlated error or
retry was present. Earlier direct probes measured a 994 KB final response for
20 broad `JESUS` results: Typesense reported about 6 ms of engine work while
Admin observed about 53 ms of private wall time.

The apparent mismatch with DEFAULT is architectural, not unexplained overhead.
DEFAULT's SQL already projects the requested locale and only target/fallback
playback rows. MODERN's catalog document embeds every published locale and all
playable audio/subtitle options, so Admin downloads and parses them before
discarding all but one. Generic queries with little playback fanout are fast;
broad multilingual titles are slow.

The corrective generation adds `watch_search_availability`, one compact record
per video/language. Final card hydration and target/fallback availability are
sent together in one private `/multi_search`; no ranking, vector, visibility,
or GraphQL field changes. A missing availability alias retries the bounded
legacy catalog projection, making application rollback independent from index
rollback. Measure the new generation before crediting a latency improvement.

### Latency budget required for the 200 ms goal

The production gate should allocate a measured budget rather than assuming
Typesense alone provides it:

| Component                                 | p95 budget |
| ----------------------------------------- | ---------: |
| Web to Admin over private/internal path   |      25 ms |
| Language and orchestration                |      15 ms |
| Query embedding, including cache lookup   |      75 ms |
| Typesense lexical and vector multi-search |      50 ms |
| Watchability/ranking/serialization        |      20 ms |
| Return path allowance                     |      15 ms |
| **Total**                                 | **200 ms** |

The lanes should run in parallel where dependencies permit. Embedding must
still finish before vector retrieval, so its provider latency is on the
critical path. A lexical-first UI followed by semantic refinement is a separate
product behavior and must not be represented as equivalent hybrid results.

### Correlated 100 + 100 latency probe

After the candidate revision is live on the shadow services, run the remote
probe from a region representative of Web traffic. Do not run it against a
developer machine:

```bash
WATCH_SEARCH_PROBE_ADMIN_URL=https://ADMIN/api/internal/search-eval/search \
WATCH_SEARCH_PROBE_ADMIN_BEARER=... \
WATCH_SEARCH_PROBE_GRAPHQL_URL=https://ADMIN/api/graphql \
WATCH_SEARCH_PROBE_RUNS=100 \
  pnpm --filter @forge/admin benchmark:watch-search-production \
  > .tmp/watch-search-production-probe.json
```

The command sends 100 accepted MODERN calls through the internal Admin server
surface and 100 through GraphQL. Every request has a unique
`clientRequestId`, and both surfaces use the normal Watch Search trace sink, so
the correlation IDs are visible in Admin analytics/APM. The report separates
Admin `latencyMs` from caller-observed round trip and contains no credentials,
queries, vectors, or response text. It also reports p50/p95 per search lane and
counts the observed `semantic_embedding` cache outcomes. `surfaceFirstSeen`
means the first occurrence on that probe surface; it is not claimed to be a
cold cache miss because production traffic or PostgreSQL L2 may already have
warmed the query. Use the lane detail (`cache_l1_hit`, `cache_l2_hit`,
`cache_coalesced`, or `cache_miss`) as the cache authority. Verify exactly 100
accepted samples per surface, zero unexplained degradation, server p95 ≤250
ms, and GraphQL round-trip p95 ≤550 ms before relevance promotion.

The absolute Mastra gate uses the 104-case `public-watch-absolute/v2` corpus.
The repository qrel file is deliberately empty until candidate results are
reviewed, so an unreviewed run cannot pass. Supply a versioned reviewed judgment
set for development; for held-out, also record the deployed Admin revision,
the checked physical catalog/availability/lexical/transcript collection names,
and named operator review. The held-out report must observe exactly the declared
Admin revision on every response and pass product-title, semantic-intent,
multilingual, expected-no-result, language, duplicate, judge, latency, and
coverage gates.

## Production Synchronization Strategy

PostgreSQL remains authoritative. Typesense documents are disposable,
rebuildable projections.

### Change capture and worker

Add a durable PostgreSQL outbox keyed by affected `videoId`. Because catalog
and transcript state are written through several sync, workflow, and mutation
paths, database triggers on the relevant source tables are safer than relying
on each caller to remember an application event. The trigger stores only the
video ID, monotonic source revision, event kind, and timestamps; it does not
copy embeddings or document payloads.

A dedicated Admin worker claims rows with `FOR UPDATE SKIP LOCKED`, coalesces
repeated video IDs, and flushes Typesense imports every 5–10 seconds. Every
JSONL import response line must be checked even when the HTTP status is 200.
Workers use idempotent whole-document upserts, bounded retries, exponential
backoff, and a dead-letter state with safe error summaries.

For each video, the worker reads the current PostgreSQL projection using the
same provenance and visibility predicates as the full indexer:

- If a viewer-visible catalog document exists, upsert its display document and
  replace its complete set of localized lexical documents keyed by
  `videoId:language-identity`. Use the unique Forge language slug as identity;
  use normalized locale only for legacy rows without a slug. BCP-47 controls
  tokenization and negotiation, not language identity.
- If it does not exist, delete that catalog ID with `ignore_not_found=true`.
- Replace the video's availability records as one idempotent set: upsert the
  current per-language records first, then delete indexed video/language IDs
  absent from PostgreSQL. Audio and subtitle state for the same language is
  merged into one record.
- Load the complete accepted native transcript chunk set for the video. Upsert
  new or changed chunks first, including the recomputed `publiclyVisible`
  value, then delete previously indexed IDs absent from the PostgreSQL set.
  This retains the broad semantic corpus while keeping frontend visibility an
  explicit serving filter.
- Delete transcript documents only when the authoritative chunk is hard-deleted
  or replaced. Soft deletion, `noIndex`, and publication changes update
  `publiclyVisible`; they do not silently discard the semantic corpus.
- Record the highest source revision only after all catalog, availability, and
  transcript operations for the video succeed. An older retry must never
  overwrite a newer projection.

### Required event behavior

| Source change                                            | Catalog action                                                                                                                         | Availability action                                     | Transcript action                                                                                        |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Video soft deletion                                      | Delete                                                                                                                                 | Delete all video records                                | Recompute all chunks as `publiclyVisible=false`                                                          |
| Video hard deletion                                      | Delete                                                                                                                                 | Delete all video records                                | Delete all chunks removed by the authoritative cascade                                                   |
| `noIndex=true`                                           | Delete                                                                                                                                 | Delete all video records                                | Recompute all chunks as `publiclyVisible=false`                                                          |
| Last published locale removed                            | Delete                                                                                                                                 | Delete all video records                                | Recompute affected chunks as `publiclyVisible=false`                                                     |
| Locale publish/unpublish/title/description               | Replace display plus the video's complete localized lexical-document set, deleting removed locale IDs; delete all if no locale remains | Rebuild or delete with catalog eligibility              | Recompute visibility for chunks in the changed locale; do not copy titles or resend embeddings           |
| Dub create/update/delete/publication/HLS/playback change | Rebuild ranking availability slugs                                                                                                     | Replace affected video/language playback record         | No vector change unless transcript source also changes                                                   |
| Subtitle create/update/delete/language/source change     | Rebuild ranking availability slugs                                                                                                     | Replace affected video/language subtitle record         | Embedding workflow emits a later transcript/vector event; stale chunks are removed when that event lands |
| Transcript re-chunk or vector replacement                | No catalog change unless language availability changed                                                                                 | No change unless availability changed                   | Upsert accepted provider/model/dimension chunks and delete stale IDs                                     |
| Image, label, slug, or child relation change             | Rebuild catalog document                                                                                                               | None                                                    | None                                                                                                     |
| Language slug/name or fallback change                    | Rebuild affected catalog documents when stored display fields change                                                                   | Rebuild records for slug/name changes; no fallback copy | No vector rewrite; Admin continues to resolve fallback policy at query time                              |

#### Ancestor fan-out for container availability (added 2026-08-28, FGE-109)

Every row above is keyed by the **affected** video id. The catalog document now
also carries `containerLanguagesJson` — the languages in which a Series-Shaped
Video has a visible playable descendant within two levels — so three of those
rows acquire a second target that the per-video keying cannot express:

| Source change                                                                                        | Additional catalog action                                                                                     |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Dub create/update/delete/publication/HLS change                                                      | Rebuild the catalog document of every Series-Shaped ancestor within two `video_relation` levels               |
| Child relation change                                                                                | Rebuild the catalog document of every Series-Shaped ancestor within two levels of both the old and new parent |
| Video visibility change (soft delete, `noIndex`, last published locale removed, `watch` restriction) | Rebuild the catalog document of every Series-Shaped ancestor within two levels                                |

A dub added to a grandchild changes its grandparent collection's availability.
An implementer who enqueues only the affected video id will ship a worker that
cannot maintain this field, which converts today's bounded staleness into
permanent drift — so treat this as a **blocking requirement** on the
incremental-sync work, not a refinement.

**Until that worker exists**, no incremental path maintains this field at all:
the only refresh is the operator-run full rebuild
(`pnpm --filter @forge/admin index:typesense-watch-search`), and that rebuild is
therefore also the only lever for an urgent descendant visibility change. The
staleness window is bounded by the interval between rebuilds and nothing
narrower. Nothing restricted is served through it — a hidden descendant is
gated out of the series page independently — so the exposure is a stale
availability claim on a card, not restricted content.

### Reconciliation and generation publication

Incremental synchronization is not the only correctness mechanism:

- Run a full count/checksum reconciliation at least daily. Alert on catalog,
  availability, or transcript cardinality drift and enqueue affected video IDs.
- Build fresh versioned catalog, availability, and localized lexical
  collections during routine release refreshes. Reuse the active transcript
  collection so an unrelated application PR does not duplicate and re-import
  280,107 vectors. Do not mutate transcript documents during this path.
- Serialize the production entrypoint with its dedicated-session PostgreSQL
  advisory lock. Hold it through build, publication, and retirement; fail fast
  when another release owns it.
- Start a transcript rebuild explicitly after transcript schema/model changes,
  a deliberate corpus-wide vector replacement, or reconciliation evidence that
  cannot be repaired safely with per-video synchronization. Do not couple this
  expensive operation to every application deployment.
- Validate import results, expected counts, viewer-safety samples, embedding
  dimensions, fixed relevance queries, and a read smoke test before publishing.
- Publish catalog, availability, and lexical physical collection names through
  one Admin-owned metadata generation record. Keep the independently reusable
  transcript collection name in the same manifest. A single PostgreSQL
  transaction changes only the members rebuilt by that operation after they
  are ready. Aliases remain useful for operator inspection and manual recovery.
- On the capacity-constrained single-node experiment, retire prior physical
  collections immediately after the new aliases publish successfully. Keep
  only the active catalog, availability, and transcript collections; retaining
  a second 280,107-vector generation exhausts the 16 GiB memory limit. Use the
  unchanged `DEFAULT` PostgreSQL backend as the immediate rollback while a
  deliberate Typesense rebuild restores any retired generation if needed.

## Topology and Capacity

### Placement

Use a dedicated Railway service named exactly `@forge/admin/search`, not the
Admin process or its container. Place it in `us-west2`, beside the current
Admin service, and access it through Railway private networking. PostgreSQL
remains the source of truth; Typesense is a disposable serving projection.
Admin receives a search-only key, while only the index worker receives the
write/admin key. The browser receives neither host nor key.

The current shadow deployment is one Typesense 30.2 container with a 16 GiB
memory budget, 2 vCPU, and a dedicated persistent volume mounted at
`/data`. The current 50 GiB volume is sufficient only while old-generation
cleanup and disk alerts remain active; use a larger temporary or separate build
target for any deliberate broad vector rebuild. Configure `/health` as the
Railway health check.

Do not attach the volume to `@forge/admin`. That service currently has two
replicas, while Railway services with volumes cannot use replicas and volume
deployments cannot run old and new containers simultaneously. Colocation would
remove Admin redundancy and introduce Admin downtime during Typesense deploys.

The guarded promotion accepts one Typesense node because PostgreSQL `DEFAULT`
remains an independent, one-setting traffic rollback. This is not automatic
failover: a Typesense outage can fail MODERN requests until the Web setting is
rolled back and the deployment completes. If that recovery interval does not
satisfy the availability objective, move to Typesense Cloud HA or three
independently persisted Typesense nodes before increasing the objective. Each
HA node stores the complete index; RAM is replicated, not split across nodes.

### RAM estimate

Typesense documents its vector memory estimate as:

```text
7 bytes × dimensions × vector records
```

For the audited broad corpus:

```text
7 × 1,536 × 280,107 = 3,011,710,464 bytes = 2.80 GiB
```

The index builder now reports this estimate with every completed build.

The 2026-08-04 read-only projection contains 176,294 compact availability
documents across 1,070 videos. Their complete source JSON is approximately
57.7 MiB, and the collection adds no vectors. Only video/language identifiers,
the language slug, and two booleans are indexed; playback and display values
are stored-only. Even a conservative 3× keyword-index multiplier is small
beside the 2.80 GiB vector term and does not change the 16 GiB capacity verdict.

| State                                               | Formula-only vector RAM | Measured process result |
| --------------------------------------------------- | ----------------------: | ----------------------: |
| One broad generation                                |                2.80 GiB |   Measure after cleanup |
| Two broad generations                               |                5.61 GiB |   Near the 16 GiB limit |
| Two generations plus an aborted 13,250-vector build |                5.74 GiB |       16,378.9 MiB peak |

The 7-byte formula is only the HNSW/vector component. It does not include
searchable strings, facets, allocator fragmentation, imports, query working
memory, or the Typesense process. Production reached 16,378.9 MiB on the
16,384 MiB node while duplicate generations were resident, so 16 GiB is not a
safe two-generation rebuild budget. Routine releases must keep one active
vector generation. Before an explicit transcript rebuild, either raise the
memory limit for the entire overlap window or build on a separate node, verify
the replacement, publish it, and retire the old generation immediately.
Transcript text, start time, images, locale JSON, and option JSON are unindexed
and primarily consume disk.

The localized lexical collection indexes one small title/metadata document per
public video localization. Splitting a video's translations into separate
documents does not duplicate title/description bytes, but it adds document IDs,
canonical IDs, locale facets, and postings. The measured searchable values must
be multiplied by the documented 2x-3x keyword factor and added to the 2.80 GiB
vector estimate. It is expected to be small relative to HNSW, but the rollout
must record the actual lexical document count, steady-state RSS, peak metadata
refresh RSS, and search p95; the text formula alone is not evidence that the
additional documents and locale fields fit the 16 GiB node.

Two 17,462-vector local generations previously used 393.2 MiB of Typesense
resident memory, 523.8 MiB process RSS, and 1.82 GiB on disk; that small local
sample did not predict the production process overhead. Record the steady-state
resident memory and disk again after stale production collections are deleted.
Configure warning at 70% and critical at 80%; scale the service before either
threshold becomes sustained and never plan to operate at the vendor's 85%
ceiling.

### Backup and recovery requirements

- Take a Typesense snapshot from the leader daily and before every schema or
  model migration.
- Copy snapshots to encrypted object storage outside the node/volume failure
  domain. Retain seven daily and four weekly snapshots.
- Keep PostgreSQL as the canonical recovery source; a full reindex must remain
  possible without a Typesense backup.
- Perform a quarterly restore drill: start one node from the snapshot, validate
  counts and smoke queries, then add empty followers and verify they synchronize.
- Set a recovery-point objective of 24 hours for snapshots plus the durable
  outbox, and prove a recovery-time objective before rollout.

### Monitoring requirements

Monitor and page on:

- `/health` failure, Raft leader/quorum state, follower lag, and restart loops.
- Memory warning at 70%, critical at 80%, and a hard capacity action before the
  vendor's 85% ceiling; any swap use is a capacity incident.
- CPU warning above 80% and critical above 90% sustained.
- Disk usage, disk latency, snapshot age/failure, and restore-drill age.
- Search count, error/timeout rate, p50/p95/p99 latency, slow-request log rate,
  and Admin-to-Typesense network time.
- Outbox oldest age, rows pending, retry count, dead letters, batch duration,
  per-line import failures, last successful full reconciliation, and catalog/
  availability/transcript count drift.
- Admin language, embedding, retrieval, watchability, GraphQL, public network,
  Prisma connection acquisition, and SQL execution as separate telemetry.

## Rollout and Rollback

1. Merge the application changes through the normal PR process. The production
   browser continues to omit `mode` and `shadowMode`. Admin recognizes an
   anonymous request whose `Origin` exactly matches `WEB_CANONICAL_ORIGIN` and
   applies its primary/shadow policy per request. The GraphQL omitted-mode
   behavior does not change for every other caller.
2. While MODERN is primary, Admin adds `shadowMode: DEFAULT` to the effective
   canonical-browser input, returns the MODERN response, and schedules DEFAULT
   through `after()` with concurrency 1 and a capacity of 64 per Admin process.
   Trusted non-fleet consumer bearers may still request shadow explicitly.
   Saturation and failures are logged but cannot change or delay the primary
   response. `Origin` is a spoofable surface discriminator, never an
   authentication or authorization boundary.
3. Primary and shadow traces share the primary request ID and carry explicit
   `primary`/`shadow` roles. Product request/click analytics, long-lived
   aggregates, and eval sampling exclude shadows so user counts and query
   intent are not doubled; raw Admin traces retain both executions for
   comparison.
4. Immediate traffic rollback is an Admin service configuration change:
   `WATCH_SEARCH_PRIMARY_MODE=DEFAULT`, followed by the normal Admin service
   restart/redeploy that applies environment changes. Admin overwrites any
   stale canonical-browser mode on every request, so cached and already-open
   Watch pages cannot retain MODERN. This stops requesting shadows as well and
   does not move Typesense aliases or delete indexes. To retain MODERN while
   stopping only comparison load, set
   `WATCH_SEARCH_DEFAULT_SHADOW_ENABLED=false` on Admin.
5. Stop promotion on visibility mismatch, relevance regression,
   synchronization lag, sustained memory pressure, elevated search errors, or
   the 550 ms full-round-trip p95 gate failing. A failed Typesense service does
   not corrupt DEFAULT, but there is no automatic request fallback in this
   release; operators must apply the rollback setting.
6. The 16 GiB service does not retain an inactive broad vector generation.
   Index recovery uses the latest external snapshot or a deliberate rebuild
   from canonical PostgreSQL data. Deleting a service, collection, or volume is
   a separate destructive action and is never part of traffic rollback.
7. Never deploy from a workstation. Application and configuration changes ship
   only through review, CI, merge to main, and the normal deployment process.
8. The production acceptance smoke must use the browser's actual contract: an
   anonymous GraphQL request with canonical Web `Origin`, no `mode`, and no
   `shadowMode`. It passes only when the response reports
   `searchMode: "watch-search-typesense"`. Repeat without the canonical origin
   to confirm the public compatibility path still reports `watch-search`.

## Native-language candidate operations

All settings below live on Railway's `@forge/admin` service. Deploying the
code does not replace public search: keep
`WATCH_SEARCH_TYPESENSE_PROFILE=CURRENT` and
`WATCH_SEARCH_CANDIDATE_COMPARISON_ENABLED=false`. The browser and public
GraphQL contract cannot select a candidate.

### Publish, enable, and compare

1. Give the indexing job `TYPESENSE_OPERATOR_API_KEY`; give runtime Admin only
   `TYPESENSE_SEARCH_API_KEY`. Keep both keys disjoint. Publish with
   `pnpm --filter @forge/admin index:typesense-watch-search-candidate`. Record
   the immutable generation ID, application revision, transcript collection
   and revision, physical members, counts, digests, and capacity prechecks.
2. Publishing moves only the Admin evaluation pointer. Confirm public
   `MODERN` still resolves `CURRENT` before enabling comparison.
3. Configure a dedicated `CANDIDATE_SEARCH_EVAL_API_KEYS` value, then set
   `WATCH_SEARCH_CANDIDATE_COMPARISON_ENABLED=true`. Use the private Admin
   comparison page. A busy/lease/rate-limit failure is expected to reject
   candidate work without queueing.
4. Set `WATCH_SEARCH_CANDIDATE_COMPARISON_ENABLED=false` immediately if public
   current-search latency, errors, CPU, memory, or pool wait changes. This is
   the comparison kill switch and does not move any index.

### Qualify without hiding latency regressions

Run three separate matched production experiments against the same frozen
identity. Do not substitute UI timings or local unit tests for these results.
The exact-title Candidate starts **not qualified**; record the following hard
limits before inspecting its measurements and do not relax them after a run:

| Evidence gate              | Pre-registered hard limit                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `exactKeyRam`              | Each distinct normalized title contributes at most 32 searchable ASCII bytes; estimated exact-key RAM is at most 3 times those bytes. |
| `incrementalNonVectorDisk` | Candidate adds at most 1 GiB of non-vector disk versus the matched Current projection.                                                |
| `steadyCapacity`           | Typesense steady memory and disk are each below 70% of provisioned capacity.                                                          |
| `peakCapacity`             | Build/import peak memory and disk are each below 80% of provisioned capacity.                                                         |
| `swapAndFreeDisk`          | Swap use is exactly zero and free disk never falls below 10 GiB during build/import and fixed load.                                   |
| `buildImportDuration`      | Candidate build/import duration is at most 1.10 times the matched Current projection build.                                           |

Each capacity gate needs a reviewed measurement artifact tied to the same
Candidate generation and Current bindings as the latency run. A summary marked
`PASS` without its own artifact reference fails qualification. Do not infer a
pass from the indexer's estimate alone, and do not copy evidence from an older
application revision or generation.

1. Run alternating single-flight latency pairs from the Admin production
   region. The command acquires and renews the exact `EVALUATION` lease, fails
   on lease or diagnostic identity drift, retains every attempt (including
   errors), and reports p50/p95/p99, result signatures, fields, bytes, calls,
   retries, subsearches, candidates, and hydration work:

   ```bash
   WATCH_SEARCH_CANDIDATE_PAIRS_PER_CASE=1000 \
     pnpm --filter @forge/admin benchmark:watch-search-candidate \
     > /secure-evidence/watch-search-candidate-paired.json
   ```

   Candidate must use the same HTTP retrieval-call count as Current and
   exactly Current plus one logical subsearch, with no retries or larger
   hydration window. Candidate allows at most six logical subsearches total.
   The diagnostic request-byte counter covers all Typesense requests, so its
   32 KiB limit conservatively guarantees that the first request is no larger
   than 32 KiB. Parsed responses may grow by at most 256 KiB per query above
   the paired Current response. Equality at either byte limit passes; one byte
   over fails.

2. Run equal-duration, equal-offered-load current-only and candidate-only
   epochs. Export per-replica Admin CPU/RSS and throughput/errors plus
   single-node Typesense CPU/RSS, disk/free space, swap, and build peak. Keep
   current-search canaries active during build. Candidate incremental
   non-vector storage must be at most 1 GiB; steady memory/disk must stay below
   70%, peak below 80%, free disk at least 10 GiB, and swap zero. Confirm only
   one transcript-vector generation is resident.
3. Measure public-current p50/p95/p99, errors, degradation, timeouts,
   throughput, CPU, and database-pool wait first without comparison and then at
   maximum comparison admission. Any worse point estimate or one-sided 95%
   bound above 5% fails the run and requires exercising the kill switch.

Run the reviewed `public-watch-absolute/v2` Mastra gate against that same
application/index identity. Missing or unreviewed qrels, missing operator
review, language errors, duplicates, any non-warmup failure/degradation,
candidate p50/p95/p99 worse than current, a 95% upper bound above 5%, extra
retries/work, capacity pressure, or current-search interference means **not
qualified**. Append samples under the same lease when confidence is
inconclusive; never restart to discard bad attempts.

The benchmark defaults every external evidence gate to `NOT_RUN` and exits
non-zero. `WATCH_SEARCH_CANDIDATE_EVIDENCE_JSON` may describe reviewed gate
statuses and artifact references only after those experiments exist. It must
contain `relevance`, `fixedLoadResources`, `exactKeyRam`,
`incrementalNonVectorDisk`, `steadyCapacity`, `peakCapacity`,
`swapAndFreeDisk`, `buildImportDuration`, `currentInterference`, and
`operatorReview`. Every `PASS` gate must have a non-empty artifact value under
the same key in `artifacts`; missing statuses or references fail closed. A
report is evidence for an operator review; it is not itself permission to
promote. For example, the shape is:

```json
{
  "relevance": "NOT_RUN",
  "fixedLoadResources": "NOT_RUN",
  "exactKeyRam": "NOT_RUN",
  "incrementalNonVectorDisk": "NOT_RUN",
  "steadyCapacity": "NOT_RUN",
  "peakCapacity": "NOT_RUN",
  "swapAndFreeDisk": "NOT_RUN",
  "buildImportDuration": "NOT_RUN",
  "currentInterference": "NOT_RUN",
  "operatorReview": "NOT_RUN",
  "artifacts": {}
}
```

This example intentionally cannot qualify and is not production evidence.

After the named reviewer approves the complete `QUALIFIED` report, compute its
SHA-256 digest from the exact file bytes. Record the report and pin Serving as
two separate operator actions; neither command accepts a failing report,
changed Current alias binding, stale Candidate identity, missing evidence,
changed attribution, or a digest mismatch. Recording never moves Serving.

```bash
REPORT=/secure-evidence/watch-search-candidate-paired.json
REPORT_SHA256="sha256:$(sha256sum "$REPORT" | cut -d ' ' -f 1)"

pnpm --filter @forge/admin qualify:typesense-watch-search-candidate -- \
  --report="$REPORT" \
  --reviewer="reviewer@example.org" \
  --operator="operator@example.org" \
  --sha256="$REPORT_SHA256"
```

Read the current `SERVING` pointer version independently, then use that exact
version for the compare-and-set pin. Reuse the same report file, identities,
and digest; the command reads and hashes the file again before pinning.

```bash
pnpm --filter @forge/admin pin:typesense-watch-search-candidate -- \
  --report="$REPORT" \
  --reviewer="reviewer@example.org" \
  --operator="operator@example.org" \
  --sha256="$REPORT_SHA256" \
  --expected-pointer-version=0
```

Both commands emit a small JSON audit result rather than the report contents.
The pin command independently reads back the `SERVING` pointer and fails if it
does not match the exact Candidate generation and resulting pointer version.
Do not copy the example identities or pointer version into a real run.

When the automatic gates did not pass but an authorized reviewer explicitly
accepts the observed Candidate, do not edit the report to say `QUALIFIED`.
Create one self-contained
`watch-search-candidate-operator-acceptance/v1` JSON bundle instead. It must
contain the exact Candidate and Current identity, an evaluation revision of
`none:operator-accepted:<decisionId>`, actual relevance and latency
measurements, every waived gate and its reason, known limitations, acceptance
rationale, raw Mastra outputs, the dated user acceptance and reviewer identity,
and a merged GitHub PR/commit trail. The PR URL and number must agree and the
commit list must contain the merge commit. The complete bundle is limited to
8 MiB.

Operator acceptance uses `TYPESENSE_OPERATOR_API_KEY` as the authenticated
production-operator boundary. The CLI stores only a stable SHA-256 fingerprint
of that credential; it never emits or stores the key. Reviewer identity comes
from the dated acceptance in the bundle. Supplying `--reviewer` or `--operator`
for this flow fails closed.

```bash
BUNDLE=/secure-evidence/watch-search-candidate-operator-acceptance.json
BUNDLE_SHA256="sha256:$(sha256sum "$BUNDLE" | cut -d ' ' -f 1)"
BUNDLE_BYTES="$(wc -c < "$BUNDLE" | tr -d ' ')"

pnpm --filter @forge/admin qualify:typesense-watch-search-candidate -- \
  --report="$BUNDLE" \
  --sha256="$BUNDLE_SHA256" \
  --byte-length="$BUNDLE_BYTES"

pnpm --filter @forge/admin pin:typesense-watch-search-candidate -- \
  --report="$BUNDLE" \
  --sha256="$BUNDLE_SHA256" \
  --byte-length="$BUNDLE_BYTES" \
  --expected-pointer-version=0
```

Both actions read the exact bytes again and verify their SHA-256 and byte
length. The stored record and operator output remain
`OPERATOR_ACCEPTED`; they never claim the automatic gates passed.

### Promote and roll back

After an exact `PASSED` or `OPERATOR_ACCEPTED` qualification record has been
reviewed, stored, and CAS-pinned to `SERVING`, promote by setting
`WATCH_SEARCH_TYPESENSE_PROFILE=CANDIDATE:<qualified-generation-id>` on
`@forge/admin`. A missing, stale, incompatible, unqualified, or
transcript-drifted pin fails closed. Publishing a newer candidate does not move
this serving pin.

- Normal rollback: set `WATCH_SEARCH_TYPESENSE_PROFILE=CURRENT` and redeploy
  Admin. Current physical indexes are retained throughout the experiment.
- Emergency independent rollback: set `WATCH_SEARCH_PRIMARY_MODE=DEFAULT` and
  redeploy Admin. This returns Watch to PostgreSQL without moving or rebuilding
  Typesense.

### Transcript changes and removal

Before replacing or mutating transcript projections, disable comparison,
invalidate every referencing candidate, and verify no serving pin or live
evaluation lease refers to the transcript. Drain all Admin replicas for the
maximum request/cache lifetime before moving an alias or deleting anything.
Revision drift invalidates old qualification evidence.

Candidate removal is resumable:

1. Return the public selector to `CURRENT` (or `DEFAULT` in an emergency),
   verify every live replica, and disable comparison.
2. Move the generation to `RETIRING`; reject new candidate work; wait for zero
   executions, references, and leases across the drain window.
3. Delete only exact candidate-owned catalog, availability, and lexical
   members, one at a time, persisting deletion progress after each success.
   Resume from that ledger after interruption.
4. Mark `RETIRED`. Never delete the generation tombstone, shared transcript,
   current aliases, or current physical collections.

## Vendor References

- [Typesense system requirements](https://typesense.org/docs/guide/system-requirements.html)
- [Running Typesense in production](https://typesense.org/docs/guide/running-in-production.html)
- [Typesense 30.2 cluster operations](https://typesense.org/docs/30.2/api/cluster-operations.html)
- [Typesense 30.2 documents API](https://typesense.org/docs/30.2/api/documents.html)
- [Typesense 30.2 search pagination](https://typesense.org/docs/30.2/api/search.html)
- [Typesense high availability](https://typesense.org/docs/guide/high-availability.html)
- [Railway volume limitations](https://docs.railway.com/volumes/reference)
