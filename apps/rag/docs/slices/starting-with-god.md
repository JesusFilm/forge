# Slice: Starting With God (starting-with-god)

_Branch: `slice/starting-with-god` · Started: 2026-05-22 · Status: done_

<!-- Status: in-progress | blocked | done -->

## Goal (architecture altitude)

Get Starting With God queryable end-to-end: acquire → ingest → retrieve →
spot-check. As slice #1 it also builds the first real path through each context
(Acquisition / Ingestion / Retrieval) — later slices reuse the machinery.

## Stages & sub-steps

`[x]` = done + verify-green + committed (sha). Resume at the first `[ ]`.

### 1. Acquire → raw_documents

- [x] `RawDocumentStore` write port + in-memory fake + Postgres adapter, wired in main; integration test writes/reads a `raw_documents` row. Idempotent per (source_key, canonical_url) so re-runs don't duplicate. <!-- sha: 01cfd8b -->
- [x] Registry: `SourceEntry`/`CrawlPolicy` pure-data types + Starting With God entry (40 article seed paths, `#content` selector + strip list, 1500ms delay, maxPages 60) + lookups (getSource/allSources/seedUrls); pure unit test. <!-- sha: a3fa409 -->
- [x] Acquisition context: `normalizeUrl()` (invariant 2 — strip fragments + tracking params, lowercase host, trim trailing slash), thin HTML extraction (node-html-parser; select `#content`, strip nav/sidebar/footer, decode entities, paragraph-preserving), `acquireOne` (fetch → extract → `RawDocument` w/ sha256 bodyHash, typed skips); fakes-only unit tests + real-fixture probe (clean 5698-char extraction). <!-- sha: 3be1c4a -->
- [x] HTTP `Fetcher` adapter in `src/adapters/http-fetch/` (browser UA, follow redirects, conditional headers honored, 304→not-modified, body returned for hashing); wired in main; co-located stubbed-fetch unit test. <!-- sha: a8a18b5 -->
- [x] `acquireSource` orchestrator in the Acquisition context (seed walk + delay + maxPages cap, stages via injected RawDocumentStore; fakes-only test) + thin `scripts/acquire.ts` + `pnpm acquire --source <key>|--all`. Typecheck + dry invocation (usage/unknown-source) green. <!-- sha: 6abfe62 -->
- [x] Live run `pnpm acquire --source starting-with-god`: **40/40 pages staged**, avg 6,843 chars (412–20,877), all titled/status-200/body_hash; spot-reads clean (article text, paragraph breaks, entities decoded). Recorded in `sources.md` (→ Acquired). <!-- sha: next -->

**Stage 1 (Acquire) complete — verify green, 40 clean rows in `raw_documents`.**

### 2. Ingest → corpus tables (needs OpenRouter key in .env)

- [x] OpenRouter `Embedder` adapter (OpenAI-compatible `/embeddings`, 1536 dims, batch ≤100, per-response dimension assertion, null-per-blank skip); wired in main. 6 stubbed-fetch unit tests. <!-- sha: 31ea558 -->
- [x] Ingestion context: normalize (clean text, registry defaults, contentHash) → chunk (jfa 500/50/min-20 ported verbatim + best-effort spans/tokens) → embed → dedup gate → idempotent replaceDocument. Adds `RawDocumentReader` read port + fake. 10 fakes-only tests. <!-- sha: 03d5ca9 -->
- [x] `scripts/index.ts`: drain `raw_documents` (ingested_at IS NULL) via ingestPending → mark consumed; `--source/--limit/--force`. Postgres `RawDocumentReader` adapter + live integration test. <!-- sha: 5a99d37 -->
- [x] Live run `pnpm index --source starting-with-god`: **40/40 docs → 183 chunks → 183 embeddings**, chunk_count consistent (declared=actual=183, 0 mismatched), chunks/doc min 1 / avg 4.6 / max 14; sample chunk is clean article text. Idempotent re-run drains 0. First run mistakenly used the `.env`'s nvidia free model; corrected by re-embedding (`--force`) → all 183 embeddings now **`openai/text-embedding-3-small`** (1536 dims), counts unchanged. <!-- sha: 7983f7e (run) / b073a0f (--force) -->

**Stage 2 (Ingest) complete — verify green, 40 docs / 183 chunks / 183 embeddings (openai/text-embedding-3-small) in the corpus. Model decision resolved.**

### 3. Retrieve → ranked results

- [x] Retrieval context (`src/retrieval/`): `createRetriever({embedder, search})` runs invariant 5 — embedQuery → vectorSearch(candidateTopK fan-out) → minScore 0.3 cutoff → soft preferSourceKey tiebreak → 3-key dedup (content-hash / canonicalUrl+ord / title+text fingerprint) → slice topK → citation assembly. Pure helpers (`candidateTopK`, `policyToFilter`) exported. 12 fakes-only tests (ranking, cutoff, fan-out count, each dedup key, scope/language filter, preference). Verify green, 59 tests. <!-- sha: 8ad378b -->
- [x] Query entry point: `retriever` wired into `main.wire()`; thin `scripts/query.ts` + `pnpm query "<q>"` (flags: `--top-k/--min-score/--source/--prefer/--language/--category`) prints ranked cited hits; `scripts/eval.ts` step-5 TODO closed (`runOne` now drives the real Retriever). Live: `pnpm query "How can I begin a relationship with God?"` → **5 distinct docs**, scores 0.54–0.59, all on-topic, each cited (title + canonical URL). <!-- sha: e413ed5 -->
- [x] Integration test — `tests/retrieval.integration.test.ts` wires the **real** `PostgresCorpusSearchStore` into `createRetriever` (stub embedder, one-hot vectors) and proves the pipeline returns real ranked + cited rows out of Postgres, with the minScore cutoff applied. Self-migrates, sentinel-scoped + cascade-cleaned, skips loudly w/o Docker (mirrors the storage-adapter integration test). Lives outside `src/` because combining an adapter with a context is composition-level — the import law (`tests-never-touch-adapters` + `adapters-import-only-contracts`) confines that to the wiring layer; `pnpm depcruise` cruises only `src/`. Registered in `vitest.config.ts` + `tsconfig.json`. 61 tests green (2 ran live against the DB). <!-- sha: 42bc3c6 -->

**Stage 3 (Retrieve) complete — verify green (61 tests, incl. live-DB retrieval integration). `pnpm query` returns ranked + cited hits; the integration test proves real data out of the RAG store. Per-document dedup confirmed (5 hits = 5 distinct URLs). Scores cluster ~0.55 — minScore 0.3 is generous (FOLLOW-UP A: re-derive from the eval baseline in Stage 4).**

### 4. Precise eval + spot-check

_(Scope confirmed by operator 2026-05-22: precise eval + tuning belongs here, not Stage 3. Stage 3 carries only the basic retrieve-over-real-store integration test, now done.)_

- [x] Author golden cases via `/golden` — **10 cases across 4 balanced personas** (seeker · skeptic · believer · newcomer), each grounded in a real ingested doc; 3 carry multi-doc accepted clusters. In `eval/qa-golden.yaml`.
- [x] Run `pnpm eval` → baseline (below); writes `eval/results-2026-05-24.md`.
- [x] Re-derive `minScore` — **0.3 → 0.37** (hard floor 0.35), policy default in `retrieve.ts`. FOLLOW-UP A resolved.
- [x] Spot-check: persona positives + 5 off-topic negatives run via `pnpm query`; relevance eyeballed.
- [x] Record findings in `sources.md` (→ Evaluated).

**Stage 4 (Eval) complete — verify green, 61 tests.** Baseline @ minScore 0.37,
top_k=8, `openai/text-embedding-3-small`: **recall@3 0.90 · recall@8 1.00 · MRR
0.82 · precision@1 0.70** (10/10 retrieved). Findings:

- `minScore` 0.3 → 0.37: weakest genuine answer (anxiety → "How to Stop Worrying")
  scored 0.383; faith-adjacent off-topic ("World Cup watch party") noise ~0.35;
  pure-secular queries return nothing. 0.37 sits just above the noise. **Hard floor
  0.35**; expect to re-derive downward as broader-topic sources land — re-confirm via
  the whole-corpus eval each slice.
- `swg-newcomer-gospel` retrieves at rank 5 — the "What is the gospel?" lesson is one
  thin chunk that richer articles outrank. Acceptable (recall@8 hit); noted.
- `swg-seeker-failure` accepts a 5-doc grace/sin/failure cluster — retrieval returned
  a tight cluster of valid answers, not one canonical doc.
- **Off-topic negatives (cutoff calibration; NOT in `qa-golden.yaml`):** "World Cup
  watch party for my church", "budget my paycheck", "marriage counselor near me",
  "weather tomorrow", "learn Python".

## Decisions made (this slice)

- 2026-05-25 — **Eval authored via `/golden`** (persona-diverse: seeker/skeptic/believer/newcomer + off-topic negatives), one **shared** `qa-golden.yaml`. **`minScore` 0.3 → 0.37** (hard floor 0.35): keep the cutoff as low as possible to admit weak-genuine answers across topical breadth, just above the ~0.35 noise floor. Per-source eval (a `source` tag per case + `pnpm eval --source <key>` scoped run + per-source breakdown in the whole-corpus run) **deferred to slice #2**, when cross-source data exists to test it against.
- 2026-05-22 — Source #1 = Starting With God — leanest of the six (44 KB / ~723 words home), server-rendered HTML, no anti-bot wall (STATUS recon).
- 2026-05-22 — Acquire scope = **bare fetch + extract + write, with a polite per-request delay** (`requestDelayMs` in the crawl policy). robots.txt fetch/disallow enforcement AND http-cache conditional fetch are **deferred** to a later step — neither is load-bearing for proving the loop on one lean site. ("as per robot" read as: behave politely with a delay, not parse robots.txt.)
- 2026-05-22 — Page discovery = **hardcoded seed list** of content URLs in the registry, not a discovery crawl. The generic-crawler-vs-per-source call stays deferred until 2–3 sources reveal the pattern (STATUS).
- 2026-05-22 — `RawDocumentStore` is the new write port for `raw_documents` (the §4 port list had no writer for the staging table); made idempotent per (source_key, canonical_url) on un-ingested rows so re-acquire doesn't duplicate.
- 2026-05-22 — `RawDocumentReader` is the new **read** port for `raw_documents` (`listPending` + `markIngested`), symmetric to the write port — mirrors the CorpusWriteStore/CorpusSearchStore split so Acquisition sees only the writer and Ingestion only the reader. Same staging-table deviation from the §4 port list, read side.
- 2026-05-22 — `char_start`/`char_end` on chunks are **best-effort source offsets** (located by matching each chunk against a whitespace-collapsed projection; sequential fallback when overlap/whitespace defeats a match). They're metadata only — retrieval ranks on the embedding, never on offsets — so approximate spans are acceptable; the columns are NOT NULL so a value is always written. `token_count` = jfa's `ceil(chars/4)`.
- 2026-05-22 — **Embedding model = `openai/text-embedding-3-small`** (locked decision-1, confirmed by operator). The first ingest run accidentally used a `.env` `EMBED_MODEL_ID` override (`nvidia/llama-nemotron-embed-vl-1b-v2:free`); both models are reachable via OpenRouter at 1536 dims (probed), so it was a free choice, not a constraint. Corrected `.env` → openai and re-embedded all 183 chunks via `--force`. Probe also confirmed openai embeddings ARE served by OpenRouter (earlier assumption that they 404 was wrong).
- 2026-05-22 — `pnpm index --force` = **full re-index from the raw snapshot** (re-drain ingested rows via `RawDocumentReader.includeIngested` + bypass the contentHash skip). The reproducible way to re-embed after a model/chunker change without re-crawling — used for the openai re-embed above.
- 2026-05-22 — **3-key dedup yields at most one chunk per distinct document.** `ScoredRow.contentHash` is document-level (`sha256(title\n\ncontent)`), and invariant 5 names content-hash as a dedup key, so a query returns diverse articles rather than several chunks of one. This is the faithful reading of the spec and why the fan-out over-fetches 3×. If spot-checks find it too aggressive (a strongly-relevant article wanting >1 chunk), relax to a per-chunk key — a clean follow-up.
- 2026-05-22 — **Composition-level integration tests live in a top-level `tests/` dir, outside `src/`.** Wiring a real adapter into a context is exactly what `main.ts` does; the import law forbids any `src/**/*.test.ts` from importing an adapter (and an `src/adapters/` test can't import a context). `pnpm depcruise` cruises only `src/`, so `tests/` is the boundary-honest home for "real store + real context" integration tests. Registered in `vitest.config.ts` (`tests/**/*.test.ts`) and `tsconfig.json` include. The storage adapter's own integration test stays co-located in `src/adapters/` (exempt, single-module). Established with `tests/retrieval.integration.test.ts`.
- 2026-05-22 — **`preferSourceKey` is a soft tiebreak, not a filter** (and not yet a score boost). It re-orders only equally-scored rows to favour the preferred source; scores are untouched. A real boost/interleave is deferred until multi-source eval exists (matches the "defer until data reveals the pattern" ethos). `allowedSourceKeys` remains the hard visibility scope. Registry-based source→domain+scopePath resolution (for sub-scoped sources) is likewise deferred — no sub-scoped source exists yet, and the store filters by `sourceKey` directly.

## Open question / blocker

- none. (Embedding-model divergence is resolved — corpus is on `openai/text-embedding-3-small`.)

## Resume hint (for a cold start)

**All four stages complete — slice ready to close.** Starting With God is acquired
(40 rows), ingested (40 docs / 183 chunks / 183 embeddings,
`openai/text-embedding-3-small`), retrievable, AND evaluated: 10 persona-diverse
golden cases in `eval/qa-golden.yaml`; `pnpm eval` baseline **recall@3 0.90 ·
recall@8 1.00 · MRR 0.82 · P@1 0.70** @ minScore **0.37** (re-derived from 0.3;
FOLLOW-UP A resolved, hard floor 0.35). Last verify: green (depcruise/typecheck/
lint, **61 tests** incl. 2 live-DB integration). **Next action: close the slice** —
set this file's status to `done`, move Starting With God → Done in `STATUS.md`, and
offer to merge `slice/starting-with-god` (the branch is a clean superset of
origin/main). Branch: slice/starting-with-god.
