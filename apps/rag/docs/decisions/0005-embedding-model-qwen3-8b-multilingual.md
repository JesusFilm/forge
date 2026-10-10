# ADR-0005 — Embedding model → `qwen/qwen3-embedding-8b` (multilingual), still 1536 dims

- Status: Accepted — provider-routing statements are refined by
  [ADR-0015](./0015-embedding-gateway-primary-openrouter-fallback.md).
- Date: 2026-07-02
- Issue/PR: [#39](https://github.com/JesusFilm/jesusfilm-rag/issues/39) (P1) · embedder PR (`embedder/qwen3-8b`)
- Related: [ADR-0002](./0002-embeddings-halfvec-1536.md) (supersedes its **model** choice; its `halfvec(1536)` storage choice stands)

**Forge migration note.** The canonical model and 1536-dimensional storage
decision remain current. Forge can route that model through an optional
OpenAI-compatible gateway with hosted OpenRouter fallback; the configured wire
alias is not the stored model identity. See ADR-0015 and
[`../ops/environment-and-secrets.md`](../ops/environment-and-secrets.md).

## Context

The corpus is going multilingual (#39): non-English sources are acquired (French
`thelife-fr`, Chinese `thelife-zh`, more to come) and we anticipate **many** languages
over time. The embedding model is a **one-way door** — changing it later means re-embedding
the entire corpus — so the model must be chosen for where the RAG is going, not only where
it is. `openai/text-embedding-3-small` (ADR-0002) is an English-lineage model ("improved
ada") with only partial multilingual ability and no committed language coverage.

## Decision

Embed with **`qwen/qwen3-embedding-8b` at 1536 dimensions** (via OpenRouter today; a
self-hosted vLLM endpoint later for prod — same adapter, config-only swap). Qwen3-Embedding
is **Matryoshka (MRL)-native** (4096 → truncate to 1536 with no retraining), so we keep the
**`halfvec(1536)`** column and HNSW cosine index unchanged — **no schema migration**.
Qwen is **instruction-aware**: query embeddings use the prefix `Instruct: {task}\nQuery:
{text}`; document embeddings are raw. `embedding_model` is recorded per row (ADR-0002
mechanism), so the swap is a re-embed, not a silent rewrite.

## Alternatives rejected

- **Keep `openai/text-embedding-3-small`** — English-lineage; MIRACL (OpenAI's own
  18-language retrieval test) only 44.0, and OpenAI publishes no supported-language list.
  On MTEB-Multilingual retrieval, Qwen3-8B (70.9) beats even OpenAI's larger, pricier
  `text-embedding-3-large` (59.3) by ~+11.6, and cross-lingual matching by ~+18.7. The gap
  vs 3-_small_ is larger. Would force a re-embed once low-resource languages land.
- **`text-embedding-3-large`** — better than small but still trails Qwen3-8B on every
  multilingual metric, is 3072-dim (would touch the schema), proprietary, and per-token.
- **BGE-M3 / multilingual-e5** — strong open multilingual models; rejected for **parity**:
  Forge already standardized on Qwen3-Embedding, so a shared vector space + one operational
  story wins. Revisit only if Qwen underperforms in practice.
- **Prove the win with a local single-language A/B** — attempted, rejected: a spot-check on
  one high-resource language (Chinese, where 3-small is least-bad) can't measure the
  multilingual/low-resource/cross-lingual long tail. The decision rests on published
  benchmarks, not a hand-rolled eval.

## Consequences

- (+) Purpose-built for 100+ languages; futureproofs the corpus against added languages
  without a forced re-embed; open-weight (self-hostable, no per-token fee at scale, no
  vendor deprecation); parity with Forge; keeps 1536 (no migration).
- (−) It's an 8B model — self-hosting needs a GPU (on-prem, [#41](https://github.com/JesusFilm/jesusfilm-rag/issues/41)). Query and document embeddings must use the **same canonical model** everywhere (serving, eval, retrieve). A retrieval-time guard (`src/retrieval/retrieve.ts`) fails loudly on a full mismatch instead of returning silent garbage; Forge's current re-index procedure is in [`../ops/corpus-maintenance.md`](../ops/corpus-maintenance.md).
- (−) One-time cost: re-embed the whole corpus (local + prod). Cheap on OpenRouter (~$0.01/M
  input tokens; full corpus ≈ pennies), but coordinated with a serving-env cutover.
- The 1536 width is still restated in `src/adapters/postgres/vector.ts` (ADR-0001); it is
  unchanged, so no coordinated width migration — only the model string + query instruction.
