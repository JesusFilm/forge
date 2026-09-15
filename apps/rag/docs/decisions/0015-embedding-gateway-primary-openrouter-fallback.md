# ADR-0015 — Embedding provider → JFP AI gateway primary, hosted OpenRouter fallback

- Status: Accepted
- Date: 2026-07-30
- Issue/PR: [#39](https://github.com/JesusFilm/jesusfilm-rag/issues/39) (P1: "self-hosted adapter, not OpenRouter") · [#58](https://github.com/JesusFilm/jesusfilm-rag/issues/58) (self-host named "the intended endgame") · PR [#57](https://github.com/JesusFilm/jesusfilm-rag/pull/57) (built the config-only swap)
- Related: [ADR-0005](./0005-embedding-model-qwen3-8b-multilingual.md) (the model this realizes the self-hosted serving plan for) · [`../ops/environment-and-secrets.md`](../ops/environment-and-secrets.md) · [`../ops/corpus-maintenance.md`](../ops/corpus-maintenance.md)

**Forge migration note.** The wiring is current in `src/main.ts`. Forge's typed
environment contract requires a complete gateway tuple when
`EMBED_BASE_URL` is set and keeps the canonical model separate from the optional
wire alias. Retry budgets are the `EMBED_*` and `QUERY_EMBED_*` settings defined
in `src/config/env.ts`.

## Context

ADR-0005 chose `qwen/qwen3-embedding-8b` "via OpenRouter today; a self-hosted
vLLM endpoint later for prod — same adapter, config-only swap", and PR #57 built
the swap levers (`EMBED_BASE_URL`, `EMBED_TRUNCATE_DIMENSIONS`). The pain that
motivated the endgame is documented in #58 (OpenRouter routing variance: 1–11s
per embed call, ingest batches up to ~40s) and #64/#118 (transient OpenRouter
blips aborting long runs). The internal **JFP AI gateway**
(`https://<ai-gateway-host>/v1`) now serves the same qwen model behind an
OpenAI-compatible `/v1/embeddings`, under its own credential and the serving
alias `embeddings`.

Two constraints shape the wiring:

1. **Vector-space identity.** `chunk_embeddings.embedding_model` is recorded per
   row and `retrieve.ts` fails loudly on a query/corpus model mismatch. The
   gateway's wire alias (`embeddings`) must never leak into that identity — the
   corpus already holds rows labeled `qwen/qwen3-embedding-8b`.
2. **Availability.** The gateway is new and internal; hosted OpenRouter is
   proven. A hard cutover would trade a flaky-latency provider for a
   single-point-of-failure one.

## Decision

**Gateway-primary with logged OpenRouter fallback**, config-activated:

- With `EMBED_BASE_URL` set, `wire()` builds a `FallbackEmbedder` whose PRIMARY
  is the gateway (`EMBED_API_KEY` credential, `EMBED_WIRE_MODEL_ID` on the wire)
  and whose FALLBACK is hosted OpenRouter (`OPENROUTER_API_KEY`), for both the
  patient corpus embedder and the fast-fail query embedder. Unset ⇒ the
  pre-gateway single-provider wiring, unchanged.
- Fallback granularity is the **whole port call**: the primary exhausts its own
  configured retry budget, then the call re-runs on
  the fallback. ANY primary error triggers it — including non-retryable ones (a
  401 from a misconfigured gateway key is exactly when the fallback should
  carry traffic). Every activation is logged (`↯ … falling back` /
  `event=query_embed_fallback`) — never silent.
- The adapter gained `wireModel`: the id sent on the wire, distinct from the
  canonical `.model` recorded per row. `FallbackEmbedder` rejects a
  primary/fallback pair whose canonical model or dimensions differ.
- `EMBED_API_KEY` is REQUIRED when `EMBED_BASE_URL` is set (env-schema refine):
  a gateway without its credential would 401 every call and ride the fallback
  forever, burning OpenRouter spend silently.
- Config comes from Doppler (`forge-rag` project): plain env-agnostic names
  (`EMBED_BASE_URL`, `EMBED_API_KEY`, `EMBED_WIRE_MODEL_ID`) in the `dev` and
  `prd` configs — same pattern as the plain `EMBED_QUERY_INSTRUCTION` already
  in `prd`; the `JFRAG_*` namespacing (prod-pointing values only) is untouched.

## Alternatives rejected

- **Hard cutover (replace OpenRouter for embedding)** — loses the proven
  provider while the gateway is young; one gateway outage would stall every
  ingest and `/v1/search` embed. The fallback costs one wrapper class.
- **Record the gateway alias as the model id** — would split the corpus into
  `embeddings` vs `qwen/qwen3-embedding-8b` rows and trip the retrieval
  mismatch guard; also collides if the gateway ever re-points the alias at a
  different model. The canonical-vs-wire split keeps row identity stable.
- **Per-batch fallback inside the adapter** — finer-grained, but couples the
  decorator to the adapter's batching internals; `embed()` is pure over its
  inputs, so re-running the whole call on the fallback is correct and simpler.
- **Circuit breaker / startup-time provider selection** — more machinery than
  the observed failure modes need; per-call fallback with logging gives the
  same protection and the logs to justify anything fancier later.

## Consequences

- (+) Embed latency and reliability stop depending on OpenRouter's provider
  routing; the spend key stops being the embedding credential; OpenRouter
  remains warm as the fallback so no single provider is a hard dependency.
- (+) Rows keep `qwen/qwen3-embedding-8b`; no re-embed, no migration, and the
  retrieval guard's semantics are preserved across providers.
- (−) A degraded (not down) gateway makes the patient corpus path slow-then-
  fallback: up to ~47s of gateway backoff per batch before OpenRouter serves.
  Acceptable for ingest; the query path caps at 2 fast attempts.
- (−) Fallback traffic still spends on the OpenRouter key — activations are
  logged precisely so sustained fallback is visible and actionable.
- (−) `OPENROUTER_API_KEY` stays required even in gateway mode (fallback +
  language detect + LLM review still use it).
