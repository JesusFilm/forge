---
title: "feat: Qwen-1536 video search for admin AI experience generation (parallel columns, per-call source)"
type: feat
status: active
date: 2026-06-05
---

# feat: Qwen-1536 video search for admin AI experience generation (parallel columns, per-call source)

## Summary

Give the admin **AI experience generator** its own video search powered by the self-hosted JesusFilm gateway (`Qwen3-Embedding-8B` → 1536-dim), so it stops depending on the (currently out-of-budget) paid OpenRouter embeddings. Do it as a **scoped pilot, not the full migration**: add parallel `embedding_qwen` columns on the two video tables, backfill them with Qwen, and route **only the Mastra `searchVideos` path** through Qwen (query) + the new column (stored) via a per-call `embeddingSource` parameter. Public `/api/search` and scene-recommendations are **not touched** — they keep using OpenAI on the existing `embedding` column, so there is zero risk to the live consumer surface.

---

## Problem Frame

When the AI generates an Experience page it calls the Mastra `searchVideos` tool to find relevant videos. That tool wraps admin's `HybridSearchService`, which embeds the query through `embeddings.service.ts` (OpenAI `text-embedding-3-small` via OpenRouter). The prod OpenRouter key is **out of budget** (`403 "Key limit exceeded"`) and there's no `OPENAI_API_KEY` fallback, so the AI's video search fails and the chat returns empty/rejected drafts. The org runs Qwen3-Embedding on its own GPU for free — routing just this feature there fixes it without paid-API exposure.

Compatibility rule that shapes the design: two embedding models are never interchangeable, even at the same 1536 width. So the AI's Qwen query must search **Qwen-embedded** video vectors — hence parallel columns, not reuse of the OpenAI column. And pgvector 0.8.2 caps HNSW at 2000 dims (verified on prod), so 1536 is the fixed, indexable width.

---

## Requirements

- R1. The Mastra `searchVideos` tool (used by admin AI experience generation) embeds its query via the gateway (Qwen 1536) and searches **Qwen-embedded** video vectors — no paid-API dependency on this path.
- R2. Public `/api/search`, `Query.search`, and `sceneRecommendations` are **unchanged** — same query model, same `embedding` column, byte-identical behavior.
- R3. The two video corpora the AI searches are backfilled into the new column with Qwen: `video_scene_locale` (~173,267) and `video_transcript_chunk` (~4,348).
- R4. The AI path's query model and the column it reads are always consistent (Qwen↔`embedding_qwen`); they can never cross-compare with OpenAI vectors.
- R5. The change is reversible: the Mastra tool can drop back to the default OpenAI source with a one-line revert; the existing `embedding` column and all public behavior remain intact throughout.

---

## Scope Boundaries

- **Not** changing public search / recommendations — they stay OpenAI + `embedding`. This is the entire safety story.
- **Not** migrating `experience_locale` embeddings (the public experience-search vectors) — out of this pilot; only the AI's _video_ search is in scope.
- **Not** a global flip — the source is a per-call parameter, defaulting to `openai`. Only the Mastra tool opts into `gateway`.
- **Not** introducing >1536 widths (HNSW ceiling) or `halfvec`.
- **Not** the chat-provider path (fixed in PR #1145) or Mastra semantic-recall memory.

### Deferred to Follow-Up Work

- **Full public-search migration to Qwen** (query + all consumers + `experience_locale`, global flip, eval gate, legacy-column drop): the larger project this pilot de-risks. Revisit once the pilot proves Qwen-1536 video relevance in production.
- **Immediate OpenRouter stop-gap** (top up the key, or set `OPENAI_API_KEY` on prod): keeps public search + any non-piloted embedding alive until/independent of this work. Do separately/now.

---

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/mastra/tools/search-videos.ts` — the AI's video search; constructs `new HybridSearchService({ prisma })` and calls `.search(...)` (line ~65). This is the **only** consumer that should pass `embeddingSource: "gateway"`.
- `apps/admin/src/services/hybrid-search.service.ts` — `search(params)`; embeds the query via `generateExperienceEmbedding(text)` (line ~270). Add an `embeddingSource` to params, thread it to both the query embed and the retrievers.
- `apps/admin/src/services/hybrid-search-retrievers.ts` — `searchVideoSemantic` reads `vsl.embedding` / `vtc.embedding` via `<=> ${queryEmbedding}::vector` (lines ~325, 356, 380). Parameterize the column on the source.
- `apps/admin/src/services/embeddings.service.ts` — `selectProvider()` (~208) + `generateExperienceEmbedding()` (~356). Add a gateway branch selectable per call; default unchanged.
- `apps/mastra/src/mastra/workflows/{scene,transcript}-embedding.ts` — produce the stored scene/transcript vectors. Their embedding provider must be able to emit Qwen 1536 for the backfill into the new column.
- `apps/admin/src/scripts/run-embeds.ts` + scene/transcript backfill services — the backfill harness; extend to target the new column when source=gateway.
- Existing per-locale HNSW index migrations for `video_scene_locale` / `video_transcript_chunk` — template for the `embedding_qwen` indexes.

### Institutional Learnings

- `docs/solutions/architecture-patterns/provider-bound-content-embedding-backfill-gate-pattern.md` — provider-bound backfill discipline (the AI path is internal, so a full eval gate is optional here, but the provenance/contract hygiene still applies).
- `docs/solutions/best-practices/pgvector-embedding-indexing-strapi-v5.md` — build the new HNSW indexes with/after the backfill, not over a cold column on the hot table.
- Root `CLAUDE.md` — embeddings must not mix across vector spaces; 1536 width is fixed.

### External References

- pgvector HNSW limit verified on prod (0.8.2): `vector` ≤ 2000 dims.
- Gateway already emits 1536 server-side (vLLM MRL `--hf-overrides`/`--pooler-config`), verified (norm 1.0).

---

## Key Technical Decisions

- **Per-call `embeddingSource` parameter, not a global flag.** `HybridSearchService.search({ ..., embeddingSource })` selects the query model AND the read column together. Public callers omit it (default `"openai"`); the Mastra `searchVideos` tool passes `"gateway"`. Public search is structurally incapable of being affected. (Full-migration global flip is deferred.)
- **Parallel `embedding_qwen` column on the two video tables only.** Scene + transcript are what `searchVideos` queries. `experience_locale` is excluded (not video search). New column is additive; existing `embedding` untouched.
- **Backfill via the existing `run-embeds` harness**, targeting the new column, source=gateway. Reuse the resumable engine; no new backfill machinery.
- **One embedding entry point per app, source-parameterized.** Admin `generateExperienceEmbedding(text, { source })`; Mastra a shared embed helper. Keeps "which model" decisions in one place each side.

---

## Open Questions

### Resolved During Planning

- How to isolate the AI path from public search: **per-call `embeddingSource` param** (above).
- Which tables get the new column: **`video_scene_locale` + `video_transcript_chunk`** (what `searchVideos` reads).
- Truncation: **server-side 1536** (gateway already emits it; clients never truncate).

### Deferred to Implementation

- Flag/param plumbing detail (where `embeddingSource` is validated; enum default `openai`).
- Whether the full 173k backfill runs up front or incrementally — the AI only "sees" backfilled scenes, so coverage vs. time is a tuning call at execution (U4/U5).
- HNSW build params for the new indexes — mirror existing unless backfill timing argues otherwise.

---

## Implementation Units

### U1. Gateway embedding branch in admin's embedder (per-call)

**Goal:** `generateExperienceEmbedding(text, { source })` can return Qwen-1536 via the gateway when `source: "gateway"`; default `"openai"` is unchanged.

**Requirements:** R1, R4, R5

**Dependencies:** None

**Files:**

- Modify: `apps/admin/src/services/embeddings.service.ts` (gateway branch in/around `selectProvider()`; `generateExperienceEmbedding` accepts an optional source; assert 1536)
- Modify: `apps/admin/src/config/env.ts` (`AI_GATEWAY_EMBEDDINGS_BASE_URL/_API_KEY/_MODEL`, all `.optional()`)
- Test: `apps/admin/src/services/embeddings.service.test.ts`

**Approach:**

- Source selection is per-call, not key-presence: explicit `"gateway"` → gateway provider (base URL/model from env, User-Agent header); default → existing OpenRouter→OpenAI precedence.
- Guard returned dimension === 1536; throw on mismatch.

**Patterns to follow:** existing `selectProvider()` records; gateway client construction in `apps/admin/src/mastra/memory.ts` `buildGatewayEmbedder()`.

**Test scenarios:**

- Happy path: `source:"gateway"` → gateway URL, 1536 vector.
- Edge case: no source → byte-identical to today.
- Error path: gateway returns ≠1536 → typed dimension-mismatch throw.
- Error path: gateway 5xx/timeout → typed embedding error.

**Verification:** gateway call returns a 1536 unit vector; default path tests unchanged.

---

### U2. Parallel `embedding_qwen` columns + HNSW indexes (scene + transcript)

**Goal:** additive 1536 columns on the two video tables, with per-locale HNSW indexes mirroring the existing ones; `embedding` untouched.

**Requirements:** R3, R4

**Dependencies:** None

**Files:**

- Create: `apps/admin/prisma/migrations/<next>_video_embedding_qwen/migration.sql`
- Modify: `apps/admin/prisma/schema.prisma` (`embedding_qwen Unsupported("vector(1536)")?` on `VideoSceneLocale`, `VideoTranscriptChunk`)
- Test: additive — covered by `prisma migrate status` probe + existing schema tests

**Approach:**

- `ADD COLUMN embedding_qwen vector(1536)` (nullable) on both tables.
- Add per-locale (`en`/`es`/`fr`) + NULL-excluded fallback HNSW indexes for the new column. On the 173k-row `video_scene_locale`, build the index with/after the backfill (U4) to avoid a slow build over a cold column on a hot table.
- Forward-only, additive.

**Patterns to follow:** existing scene/transcript HNSW index migrations; admin Migrations runbook in `apps/admin/CLAUDE.md`.

**Test scenarios:**

- Test expectation: none (additive schema/index). Verify via migrate-status probe and `\d` showing the new column/indexes.

**Verification:** migration applies on a copy; new column + indexes present; `embedding` unchanged.

---

### U3. Source-parameterized search service + retrievers; Mastra tool opts into gateway

**Goal:** `HybridSearchService.search` accepts `embeddingSource`; query model and read column move together; the Mastra `searchVideos` tool passes `"gateway"`; public callers unchanged.

**Requirements:** R1, R2, R4

**Dependencies:** U1, U2

**Files:**

- Modify: `apps/admin/src/services/hybrid-search.service.ts` (thread `embeddingSource` → query embed + retriever column; default `"openai"`)
- Modify: `apps/admin/src/services/hybrid-search-retrievers.ts` (`searchVideoSemantic` reads `embedding` vs `embedding_qwen` from a closed two-literal allowlist via `Prisma.raw`)
- Modify: `apps/admin/src/mastra/tools/search-videos.ts` (pass `embeddingSource: "gateway"`)
- Test: `apps/admin/src/services/hybrid-search.regression.test.ts` (public default byte-identical), retriever tests, `search-videos` tool test

**Approach:**

- One resolved value drives both sides per call — no divergence possible.
- Column injected via `Prisma.raw` on a fixed allowlist (never user input); unknown/absent → `openai`.
- Public REST/GraphQL/scene-recs never pass the param → no change.

**Patterns to follow:** `normalizeMode()` tolerant-flag + `hybrid-search.regression.test.ts` byte-identity guard; existing `Prisma.raw` discipline.

**Test scenarios:**

- Happy path (default): retriever SQL uses `embedding`, OpenAI query — regression test byte-identical.
- Happy path (gateway): retriever SQL uses `embedding_qwen`, gateway query.
- Edge case: unknown source → `openai` fallback + one warn log.
- Integration: `searchVideos` tool issues a gateway query against seeded `embedding_qwen` and returns matching videos; public `/api/search` test path unaffected.

**Verification:** the Mastra tool searches Qwen-space; public search tests unchanged.

---

### U4. Backfill scene + transcript vectors into `embedding_qwen` (Qwen)

**Goal:** the video corpora the AI searches have Qwen-1536 vectors in the new column; live `embedding` untouched.

**Requirements:** R3

**Dependencies:** U2, plus Mastra-side gateway embedding for the workflows

**Files:**

- Modify: `apps/mastra/src/mastra/workflows/{scene,transcript}-embedding.ts` (emit Qwen 1536 when source=gateway) + `apps/mastra/src/config/env.ts`
- Modify: `apps/admin/src/scripts/run-embeds.ts` + scene/transcript backfill services (target `embedding_qwen` when source=gateway)
- Test: colocated workflow tests; `run-embeds.test.ts`; service write tests asserting writes land in `embedding_qwen`

**Approach:**

- Run `run-embeds --pipeline=scene` then `--pipeline=transcript` (gateway source) from the admin worker, writing the new column. Resumable; tune batch/concurrency to the single GPU. Build the U2 indexes during/after.
- Live `embedding` column never written by this path.

**Execution note:** long-running; run under `tmux`/`nohup`, watch `run-embeds.*` events; safe to resume. Coverage is incremental — the AI sees only backfilled scenes, so a full run is preferred before relying on it.

**Patterns to follow:** `run-embeds` resumable backfill; local-embed-pipeline runbook in `apps/admin/CLAUDE.md`.

**Test scenarios:**

- Happy path: writes land in `embedding_qwen` only; `embedding` untouched.
- Edge case: re-run idempotent.
- Error path: per-target gateway failure isolated/retryable.
- Integration: post-backfill `count(embedding_qwen)` approaches `count(embedding)` on both tables.

**Verification:** `SELECT count(embedding_qwen) FROM video_scene_locale` (and transcript) grows to ~parity; new indexes used in `EXPLAIN`.

---

### U5. Enable + verify the AI video-search pilot

**Goal:** in prod, AI experience generation finds videos via Qwen with no OpenRouter dependency; public search verified unchanged; documented revert.

**Requirements:** R1, R2, R5

**Dependencies:** U3, U4

**Files:**

- Config: ensure `AI_GATEWAY_EMBEDDINGS_*` set on `@forge/admin` (+ worker) and Mastra.
- Docs: add a short "AI video-search on Qwen (pilot)" runbook to `apps/admin/CLAUDE.md` (how it's scoped, how to revert the tool to `openai`).

**Approach:**

- With the tool passing `gateway` and the backfill complete, run a "Generate full page" in prod and confirm real video candidates appear (no `403`, no empty response).
- Confirm public `/api/search` still returns its usual results (OpenAI path).
- **Revert:** change the tool's `embeddingSource` back to `"openai"` (one line) — instantly restores the prior behavior; new column stays for retry.

**Test scenarios:**

- Test expectation: none (config + ops). Verification below.

**Verification:** AI experience generation returns non-empty drafts with real videos; public search unchanged; reverting the tool param restores prior AI behavior.

---

## System-Wide Impact

- **Interaction graph:** only `searchVideos` → `HybridSearchService.search(gateway)` changes; public REST/GraphQL/scene-recs call the same service without the param and are unaffected.
- **Error propagation:** gateway-unreachable / wrong-dim → typed errors; the AI candidate search already degrades to token ranking, so failure is non-fatal to chat.
- **State lifecycle risks:** backfill writes only the new column; the live column is never mid-mutation; build new-column indexes off the hot path.
- **API surface parity:** none — no public response shape changes.
- **Unchanged invariants:** `embedding` column, its indexes, and every public search/recs behavior remain exactly as today (R2/R5) — that is the rollback guarantee.

---

## Risks & Dependencies

| Risk                                             | Mitigation                                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Partial backfill → AI sees only some videos      | Prefer a full scene/transcript backfill before relying on the pilot; it's resumable       |
| Single-GPU gateway throughput slow for 173k      | Resumable `run-embeds`; runs off the live path; can proceed incrementally                 |
| Accidental leak of the param into public search  | Default `openai`; only the Mastra tool sets it; regression test pins public byte-identity |
| New-column index build locks hot scene table     | Build on the new column, with/after backfill                                              |
| OpenRouter still out of budget for public search | Deferred stop-gap (top up / `OPENAI_API_KEY`) — independent of this pilot                 |

---

## Documentation / Operational Notes

- Add the pilot runbook to `apps/admin/CLAUDE.md`: the `embeddingSource` param, that only `searchVideos` uses `gateway`, the backfill commands, and the one-line revert.
- Record the gateway 1536 config (vLLM `--hf-overrides`/`--pooler-config`; backup `docker-compose.yml.bak.pre-mrl1536`).
- After it lands, capture a `ce-compound` learning: "per-call embeddingSource — piloting a new embedding model on one consumer via a parallel column without touching public search."

---

## Sources & References

- Pattern: `docs/solutions/architecture-patterns/provider-bound-content-embedding-backfill-gate-pattern.md`
- pgvector indexing: `docs/solutions/best-practices/pgvector-embedding-indexing-strapi-v5.md`
- Admin runbooks: `apps/admin/CLAUDE.md` (Scene/Transcript embeddings, Hybrid search, Running embeds locally)
- Sibling fix already merged: chat-path provider routing PR #1145
- Deferred larger effort: full public-search Qwen migration (this pilot de-risks it)
