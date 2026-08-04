# Typesense Watch Search Production Readiness

This report evaluates the parallel `MODERN` Watch Search backend and defines a
reversible shadow deployment. It does not change the `DEFAULT` PostgreSQL
backend or authorize frontend traffic before the rollout gates pass.
Admin remains the public search gateway and owns language interpretation,
query embeddings, visibility, watchability, analytics, degradation, and the
GraphQL contract. Typesense is a private serving index for lexical and semantic
retrieval.

## Decision

Provisioning a private, single-node shadow service is safe after the normal PR
is reviewed, merged, and deployed. Name that Railway service exactly
`@forge/admin/search`. Do not send user traffic to it yet. Frontend rollout is
**not ready** until all of these gates pass:

1. Complete and record the full 280,107-vector rebuild and benchmark on the
   isolated `@forge/admin/search` shadow service.
2. Pass the relevance suite, including broad exact-title queries such as
   `JESUS`, with no viewer-visibility regressions.
3. Demonstrate Typesense retrieval p95 below 50 ms under production-shaped
   read traffic while a synchronization batch and a full rebuild run.
4. Demonstrate hybrid Watch Search full-round-trip p95 below 200 ms. The
   current embedding and public Web-to-Admin paths cannot meet this gate.
5. Operate synchronization, reconciliation, backup restore, and rollback in
   the shadow service before any user traffic is enabled.

`MODERN` must remain explicit opt-in. Omitted mode and `DEFAULT` continue to use
PostgreSQL. Do not expose Typesense directly to Web or ship a write/admin key to
a browser.

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
documents. The transcript collection now retains the broad corpus and stores a
faceted `publiclyVisible` boolean on every vector. Public Watch Search always
filters `publiclyVisible:=true`; a future authorized AI surface can apply a
different explicit policy without rebuilding a metadata-only index.

Do not run the production-sized corpus on a developer workstation. After the
normal PR merge, run the initial broad rebuild inside the isolated
`@forge/admin/search` shadow service. The no-argument index command detects the
missing transcript alias and bootstraps it. Later routine releases reuse that
physical transcript collection and rebuild only catalog and availability.
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

Modern now requests at least 100 lexical candidates, marks whole-title matches,
applies the same 0.45 whole-title versus 0.20 broader-title evidence distinction,
and sorts by whole-title match, uncapped ranking relevance, watchability, then
stable ID. A regression test proves that `JESUS` ranks ahead of `JESUS Film`.
The full snapshot benchmark must still establish top-ten parity; the unit test
only proves the identified tie is fixed.

Modern also pages lexical retrieval in 250-hit Typesense pages before global
reranking. This fixes the previous empty-page behavior at offset 250 and covers
up to 12,500 candidates within Typesense's default 50-search multi-search limit,
well above the current 1,107-video catalog. Alert before catalog growth or UI
pagination approaches that explicit serving window.

Semantic retrieval has not been removed. Modern still generates the query
embedding and searches the Typesense transcript vector collection. If embedding
generation misses its deadline, only that request degrades to lexical results.
Modern now measures embedding and Typesense semantic retrieval as separate
lanes instead of charging retrieval with embedding time.

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

| Stage                       |                                      p50 |                             p95 | Interpretation                                                                                                                                             |
| --------------------------- | ---------------------------------------: | ------------------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Query embedding             |                                   478 ms |                        4,965 ms | Main degraded-path cost; the old timeout budget was about 5 s.                                                                                             |
| Language resolution         |                           1–4 ms healthy |     3,379 ms sampled slow trace | Normally small; a simple language query becomes slow during database congestion.                                                                           |
| Metadata retrieval          |                                    43 ms |                          179 ms | PostgreSQL keyword/trigram retrieval in the logged `DEFAULT` population.                                                                                   |
| Semantic retrieval          |                                    70 ms |                          252 ms | PostgreSQL pgvector retrieval after an embedding exists.                                                                                                   |
| Exact-title retrieval       |                                    10 ms |                           81 ms | Exact lexical lane.                                                                                                                                        |
| Metadata watchability       |                                    30 ms |                          125 ms | Candidate visibility/playability hydration.                                                                                                                |
| Exact watchability          |                                     0 ms |                           93 ms | Zero represents skipped lanes without exact candidates.                                                                                                    |
| Semantic watchability       |                                    19 ms |                           65 ms | Semantic candidate visibility/playability hydration.                                                                                                       |
| Analytics trace persistence |                    usually below its cap |                capped at 250 ms | The resolver awaits the safe trace sink after search; this time is excluded from `response.latencyMs` but included in GraphQL and full-round-trip latency. |
| Public Web-to-Admin hop     | about 1,014 ms in a recent healthy trace | not available as a distribution | Time before the Admin request began; includes public routing/proxy/network or queueing that current spans cannot split further.                            |
| Admin-to-Typesense network  |                        local only so far |    production evidence required | Must use private same-region networking and be measured under load.                                                                                        |

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
the Web-to-Admin hop, GraphQL serialization, and the resolver's awaited search
trace write. Production APM includes those costs. A sampled slow trace reached
the trace sink's 250 ms deadline; the database write continued in the
background, but the resolver returned only after that deadline. Production load
tests must measure this lane separately and should evaluate decoupling it from
response completion without weakening analytics durability.

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

- If a viewer-visible catalog document exists, upsert it by video ID.
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

| Source change                                            | Catalog action                                                       | Availability action                                     | Transcript action                                                                                        |
| -------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Video soft deletion                                      | Delete                                                               | Delete all video records                                | Recompute all chunks as `publiclyVisible=false`                                                          |
| Video hard deletion                                      | Delete                                                               | Delete all video records                                | Delete all chunks removed by the authoritative cascade                                                   |
| `noIndex=true`                                           | Delete                                                               | Delete all video records                                | Recompute all chunks as `publiclyVisible=false`                                                          |
| Last published locale removed                            | Delete                                                               | Delete all video records                                | Recompute affected chunks as `publiclyVisible=false`                                                     |
| Locale publish/unpublish/title/description               | Rebuild localized catalog document, or delete if no locale remains   | Rebuild or delete with catalog eligibility              | Recompute visibility for chunks in the changed locale                                                    |
| Dub create/update/delete/publication/HLS/playback change | Rebuild ranking availability slugs                                   | Replace affected video/language playback record         | No vector change unless transcript source also changes                                                   |
| Subtitle create/update/delete/language/source change     | Rebuild ranking availability slugs                                   | Replace affected video/language subtitle record         | Embedding workflow emits a later transcript/vector event; stale chunks are removed when that event lands |
| Transcript re-chunk or vector replacement                | No catalog change unless language availability changed               | No change unless availability changed                   | Upsert accepted provider/model/dimension chunks and delete stale IDs                                     |
| Image, label, slug, or child relation change             | Rebuild catalog document                                             | None                                                    | None                                                                                                     |
| Language slug/name or fallback change                    | Rebuild affected catalog documents when stored display fields change | Rebuild records for slug/name changes; no fallback copy | No vector rewrite; Admin continues to resolve fallback policy at query time                              |

### Reconciliation and generation publication

Incremental synchronization is not the only correctness mechanism:

- Run a full count/checksum reconciliation at least daily. Alert on catalog,
  availability, or transcript cardinality drift and enqueue affected video IDs.
- Build fresh versioned catalog and availability collections during routine
  release refreshes. Reuse the active transcript collection so an unrelated
  application PR does not duplicate and re-import 280,107 vectors.
- Start a transcript rebuild explicitly after transcript schema/model changes,
  a deliberate corpus-wide vector replacement, or reconciliation evidence that
  cannot be repaired safely with per-video synchronization. Do not couple this
  expensive operation to every application deployment.
- Validate import results, expected counts, viewer-safety samples, embedding
  dimensions, fixed relevance queries, and a read smoke test before publishing.
- Publish the catalog and availability physical collection names through one
  Admin-owned metadata generation record. Keep the independently reusable
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
`/data`. Start with 50 GiB only if disk alerts and old-generation cleanup are
active; 100 GiB is the safer initial allocation while broad two-generation disk
use is being measured. Configure `/health` as the Railway health check.

Do not attach the volume to `@forge/admin`. That service currently has two
replicas, while Railway services with volumes cannot use replicas and volume
deployments cannot run old and new containers simultaneously. Colocation would
remove Admin redundancy and introduce Admin downtime during Typesense deploys.

A single shadow node is acceptable because it serves no user traffic and
`DEFAULT` remains available. Before Typesense becomes the default user path,
either prove that immediate PostgreSQL fallback satisfies the availability
objective or move to Typesense Cloud HA / three independently persisted
Typesense nodes. Each HA node stores the complete index; RAM is replicated, not
split across nodes.

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

| State                                       | Vector RAM | Planning process RAM |
| ------------------------------------------- | ---------: | -------------------: |
| One broad generation                        |   2.80 GiB |        about 3.1 GiB |
| Two broad generations during atomic rebuild |   5.61 GiB |        about 5.7 GiB |
| Two generations plus 30% operating headroom |          — |        about 7.4 GiB |

The former 8 GiB estimate is therefore a minimum for safe versioned rebuilds,
not an estimate that the active index alone consumes 8 GiB. The deployed
16 GiB limit provides additional rebuild and query headroom. Searchable strings,
facets, allocator fragmentation, imports, query working memory, and the
Typesense process add to the vector formula. Transcript text, start time,
images, locale JSON, and option JSON are unindexed and primarily consume disk.
Routine application releases keep one vector generation, so they do not incur
the temporary second-generation vector RAM shown in the table. That peak is
reserved for an explicit transcript rebuild.

Two 17,462-vector local generations previously used 393.2 MiB of Typesense
resident memory, 523.8 MiB process RSS, and 1.82 GiB on disk. Provision the
shadow service with the deployed 16 GiB memory budget and 100 GiB volume,
then replace the planning figures above with its measured resident memory,
RSS, disk, and peak import memory before enabling any traffic. Configure
warning at 70% and critical at 80%; scale the service before either threshold
becomes sustained and never plan to operate at the vendor's 85% ceiling.

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

1. Merge through the normal PR process, then provision the private
   `@forge/admin/search` shadow service. Keep `DEFAULT` unchanged and do not
   route user traffic during initial indexing and soak monitoring.
2. Replay a privacy-safe sample of real query shapes and the fixed multilingual
   suite against both backends. Review top results, availability, evidence,
   overlap, zero-result rate, and click/play outcomes.
3. Once all gates pass, canary Modern behind Admin at 1%, 5%, then 25%. Stop on
   visibility mismatch, relevance regression, synchronization lag, memory
   pressure, error-rate increase, or the 200 ms p95 gate failing.
4. Roll back traffic by disabling the Modern flag or removing the Typesense
   connection variables from Admin; omitted/`DEFAULT` requests already use
   PostgreSQL. Roll back index state by selecting the previous active
   generation. These are independent, no-schema-change controls. During the
   availability migration, application code retries legacy bounded catalog
   hydration only when that alias is missing. A routine metadata rollback moves
   catalog and availability back together and leaves the reused transcript
   alias untouched. An explicit transcript rebuild may also roll its transcript
   alias back to the preceding healthy collection.
5. A failed shadow service cannot break `DEFAULT`. Stop its deployment if it
   exceeds memory/disk thresholds; retain its volume until diagnosis. Deleting
   the service or volume is a separate destructive action and is never part of
   the immediate rollback.
6. Never deploy from a workstation. Ship application/config changes through
   the normal pull-request merge and main deployment process after review and
   CI; provision Railway only after that merge is live.

## Vendor References

- [Typesense system requirements](https://typesense.org/docs/guide/system-requirements.html)
- [Running Typesense in production](https://typesense.org/docs/guide/running-in-production.html)
- [Typesense 30.2 cluster operations](https://typesense.org/docs/30.2/api/cluster-operations.html)
- [Typesense 30.2 documents API](https://typesense.org/docs/30.2/api/documents.html)
- [Typesense 30.2 search pagination](https://typesense.org/docs/30.2/api/search.html)
- [Typesense high availability](https://typesense.org/docs/guide/high-availability.html)
- [Railway volume limitations](https://docs.railway.com/volumes/reference)
