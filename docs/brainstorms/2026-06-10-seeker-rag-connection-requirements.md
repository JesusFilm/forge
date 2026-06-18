---
date: "2026-06-10"
topic: "seeker-rag-connection"
---

# Seeker Agent — Real Retrieval via jesusfilm-rag

## Summary

Replace the seeker agent's stub `retrieveAnswer` tool with a real connection to
the `JesusFilm/jesusfilm-rag` retrieval service. The tool calls the service's
versioned HTTP search endpoint with a bearer token and returns ranked, cited
passages; the seeker agent's own LLM synthesizes grounded, source-attributed
answers from them.

---

## Problem Frame

feat-198 shipped the seeker agent skeleton with a deliberately stubbed
`retrieveAnswer` tool: it returns a fixed `[stub]` placeholder and empty
`sources`, so the agent can demonstrate the chat → tool-call → memory shape in
Studio but cannot actually ground a factual answer. The stub's contract was
marked provisional pending RAG design.

That RAG now exists. `JesusFilm/jesusfilm-rag` is a standalone, retrieve-only
service (Postgres + pgvector, published OpenAPI v1 contract, per-consumer
bearer auth) whose architecture doc names Mastra agents as an intended
consumer. It is deployed on the organization's Railway account at a stable URL,
and a bearer token for this consumer can be issued quickly. The missing piece
is entirely on our side: the tool, its configuration, and the agent
instructions that turn retrieved passages into cited answers.

---

## Key Decisions

- **Passages only — generation stays in the caller.** The RAG's design tenet is
  "consumers ask, this service retrieves." The tool returns cited passages and
  the seeker agent's LLM composes the answer in conversation. No tool-side
  LLM call, no second model hop.
- **Direct HTTP against the v1 contract.** The service's MCP adapter does not
  exist yet; the published `/v1` REST contract is the only door and is
  contract-stable (additive-only within v1).
- **Optional configuration with graceful degradation.** Continues feat-198's
  zero-new-required-env-vars rule: the RAG base URL and bearer token are
  optional in `apps/mastra/src/config/env.ts`. Unconfigured, the app boots and
  every other workflow runs; only the tool degrades to an explicit
  "retrieval unavailable" result.
- **Connect to the live production deployment now.** Its corpus is currently
  thin (one source indexed), but the contract and auth shape are identical as
  the corpus grows — corpus coverage is the RAG repo's concern, not a blocker
  here.

---

## Requirements

**Retrieval behavior**

- R1. The `retrieveAnswer` tool retrieves from the jesusfilm-rag service's
  versioned HTTP search endpoint, authenticated with a per-consumer bearer
  token.
- R2. The tool returns ranked, cited passages — text, source name, title, URL,
  and relevance score — and performs no answer generation of its own. Replacing
  the stub's `{ answer, sources }` output is a breaking schema change: the
  `answer` field is removed, and existing tests and consumers of the old shape
  update alongside.
- R3. The seeker agent's instructions direct it to synthesize answers from
  returned passages and attribute sources by name and URL.
- R4. When retrieval returns no passages, the tool states that plainly and the
  agent says it has no grounded answer rather than answering from memory.
- R5. Retrieval failures (unconfigured, auth rejection, timeout, service error)
  surface as typed, non-throwing tool results; the agent tells the user
  retrieval is unavailable and the agent loop never crashes.

**Configuration**

- R6. The RAG base URL and bearer token are new optional entries in
  `apps/mastra/src/config/env.ts`; the app boots and deploys without them. The
  base URL is gated by a companion allowed-hosts guard, following the pattern
  every other outbound client in this app already uses.
- R7. The new variables are documented in `apps/mastra/.env.example`.
- R8. The outbound call carries an explicit timeout sized against the RAG's
  embedding-dominated tail latency — its own reference client uses a 5s
  ceiling (typical is ~0.8–1.4s) — and shorter than any upstream caller
  budget. The client makes one attempt per tool call; no retry or backoff.

**Safety**

- R9. The stub's pinned `[stub]`-marker regression test is replaced by guards
  at both layers: the tool's `sources` contain only passages the RAG actually
  returned, and the agent's instructions forbid citing any source name or URL
  not present in the current tool result.
- R10. The seeker agent stays Studio-only; the feat-198 route-isolation test
  continues to pass and no new public surface is added.

**Verification**

- R11. End-to-end verification runs in Studio against the live RAG service: a
  factual question fires the tool, real passages return, and the agent's answer
  cites them.

---

## Acceptance Examples

- AE1. **Covers R5, R6.**
  - **Given** the RAG env vars are unset,
  - **When** the app boots and the seeker agent calls the tool,
  - **Then** boot succeeds, and the tool returns an explicit
    retrieval-unavailable result instead of throwing.
- AE2. **Covers R1, R2, R3, R11.**
  - **Given** a configured token and URL,
  - **When** a tester asks "How do I become a Christian?" in Studio,
  - **Then** the tool returns real passages from the RAG, the agent's answer
    cites their source names and URLs, and every URL the agent cites appears in
    the returned passages.
- AE3. **Covers R4, R9.**
  - **Given** a question with no relevant corpus content,
  - **When** the RAG returns empty results,
  - **Then** the agent says it has no grounded answer and offers no fabricated
    sources.
- AE4. **Covers R5.**
  - **Given** the RAG is unreachable or rejects the token,
  - **When** the tool fires,
  - **Then** it returns a typed failure, the agent communicates that retrieval
    is unavailable, and the conversation continues.

---

## Scope Boundaries

- Prod corpus backfill and source coverage — owned by the jesusfilm-rag repo;
  we consume whatever is indexed.
- The seeker agent's guardrail gate, full persona, and public exposure — still
  deferred per feat-198.
- MCP integration — revisit if the RAG ships its MCP adapter.
- Tool-side answer generation.
- Language filtering — the corpus is English-only today. The RAG's language
  filter is an exact match on bare codes (`"en"`), so planning either
  normalizes the BCP-47 locale hint or omits the language filter entirely; raw
  pass-through of regional tags (e.g. `"en-US"`) returns zero passages on
  every query.
- Relevance-threshold tuning and weak-passage decline behavior — deferred to
  the guardrail gate. The RAG's default cutoff deliberately admits
  weak-but-genuine matches, so until that gate lands the agent may synthesize
  from weakly-relevant passages.

---

## Dependencies / Assumptions

- A bearer token for this consumer must be issued in the RAG service's token
  registry, with the all-sources (`*`) scope — a token scoped to specific
  source keys returns silent empty results for everything outside it, and
  newly indexed sources would stay invisible without re-scoping. Blocking for
  end-to-end verification (R11), not for merging the code — unconfigured
  behavior is defined (AE1).
- The RAG service URL is stable: the move to the organization's Railway account
  has already happened.
- The RAG's prod corpus currently has one indexed source; acceptable for this
  milestone.
- The `/v1` contract as published in the RAG repo's `contracts/openapi.v1.json`
  is the integration surface: strict request schema (unknown fields rejected),
  results envelope with per-passage citations, typed JSON errors.

---

## Outstanding Questions

**Deferred to Planning**

- Exact env var names, client module shape, and the tool's output schema
  mapping of passages.
- Retrieval policy defaults (top-k, minimum score) — the service applies
  sensible defaults when omitted; planning decides whether to override.
- Token lifecycle — who owns the seeker consumer's bearer token in the RAG
  registry and the expected rotation/revocation path; settle when the token is
  issued.

---

## Sources / Research

**jesusfilm-rag repo** (`JesusFilm/jesusfilm-rag`, default branch `main`):

- `contracts/openapi.v1.json` — the `/v1/search` and `/v1/health` contract;
  generated from Zod schemas with a CI drift test, published for consumers to
  pin against.
- `src/serving/http/auth.ts` — bearer model: per-consumer tokens in a
  `SERVE_BEARER_TOKENS` JSON map, each scoped to source keys; requests may
  narrow but never widen scope.
- `scripts/smoke.ts` — the canonical ~30-line reference client (fetch + bearer
  - response validation); observed latency 0.8–1.4s, smoke ceiling 5s.
- `docs/architecture.md` — "mechanism, not policy": ranking is similarity plus
  declared policy; audience weighting belongs to the consumer. No rate limits
  implemented. No source-discovery endpoint yet — valid source keys are known
  out-of-band.

**This repo:**

- `apps/mastra/src/mastra/tools/retrieve-answer.ts` — the stub being replaced;
  its header anticipated passage-shaped sources.
- `apps/mastra/src/services/firecrawl-client.ts` — the in-app HTTP client
  pattern to mirror: typed result unions with `retryable` classification,
  timeout, config accessor.
- `apps/mastra/src/config/env.ts` + `apps/mastra/.env.example` — where optional
  config lands.
- `docs/roadmap/ai-chat/feat-198-seeker-agent-skeleton.md` and
  `docs/plans/2026-06-08-003-feat-seeker-agent-skeleton-plan.md` — the skeleton
  this builds on, including the safety posture this work carries forward.
