---
id: "feat-199"
title: "Seeker Agent RAG Retrieval Connection"
owner: "jian wei"
priority: "P2"
status: "complete"
start_date: "2026-06-10"
duration: 3
depends_on:
  - "feat-198"
blocks:
  - "feat-204"
tags:
  - "search"
---

## Resolution

**Shipped:** 2026-06-18 via [PR #1279](https://github.com/JesusFilm/forge/pull/1279) (`feat(mastra): connect seeker agent retrieveAnswer to jesusfilm-rag`, commit `ca136fda`).

**What landed.** Replaced the stubbed `retrieveAnswer` with a real typed HTTP client (`jesusfilm-rag-client.ts`) of the `JesusFilm/jesusfilm-rag` `/v1/search` service: bearer auth, strict request body, a Zod-parsed passage envelope, a typed no-throw result union (`config_missing` / `auth_failed` / `network_error` / `rejected` / `parse_error` / timeout), a single attempt bounded by `AbortSignal.timeout`, and a production https + allowed-hosts boot guard. The tool now returns passage-shaped `sources` plus an `ok` / `empty` / `unavailable` status; the agent synthesizes source-cited answers and declines plainly when there is no grounded answer. All RAG env vars are `.optional()` — unset degrades at runtime, never bricks boot. Verified live in Studio on 2026-06-18 (real passages returned, citations correct).

**Compound docs.** `docs/solutions/conventions/single-service-http-client-result-union-convention.md` (this client is its single-attempt reference); `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`.

**Residual risk / follow-ups.** Relevance-threshold tuning, weak-passage decline behavior, faithfulness/groundedness evals, and the guardrail gate are deferred. The prod corpus currently has one indexed source; RAG token issuance is an out-of-repo ops step.

> Requirements:
> `docs/brainstorms/2026-06-10-seeker-rag-connection-requirements.md`.

## Problem

feat-198's seeker agent ships with a stubbed `retrieveAnswer` tool: it returns
a fixed `[stub]` placeholder with empty `sources`, so the agent cannot ground
factual answers. The RAG it was waiting on now exists —
`JesusFilm/jesusfilm-rag`, a standalone retrieve-only service with a published
OpenAPI `/v1` contract, per-consumer bearer auth, and a stable org-Railway
deployment. This work rewires the stub into a real HTTP client of that service:
the tool returns ranked, cited passages and the seeker agent's LLM synthesizes
source-attributed answers from them. Generation stays in the caller per the
RAG's design tenet.

## Entry Points — Read These First

1. `docs/brainstorms/2026-06-10-seeker-rag-connection-requirements.md` —
   requirements (R1–R11), acceptance examples, scope boundaries.
2. `apps/mastra/src/mastra/tools/retrieve-answer.ts` — the stub being replaced;
   keep the exported pure-executor + `createTool` wrapper shape.
3. `apps/mastra/src/services/firecrawl-client.ts` — PRIMARY template for the
   new RAG client: typed `{ ok: true } | { ok: false, reason, retryable }`
   result union, timeout handling, injectable `fetchImpl` for tests.
4. `apps/mastra/src/config/env.ts` — where the optional RAG env vars and a
   config accessor land (mirror `getFirecrawlConfig`).
5. `apps/mastra/src/mastra/agents/seeker-agent.ts` — instructions must be
   updated for passage synthesis + source citation; guardrail attach-point
   comment stays.
6. In `JesusFilm/jesusfilm-rag` (read via `gh api`, do NOT vendor code):
   `contracts/openapi.v1.json` (the contract), `scripts/smoke.ts` (reference
   client), `src/serving/http/auth.ts` (bearer semantics).

## Grep These

- `executeRetrieveAnswer|retrieveAnswerTool` in `apps/mastra/src` — stub call
  sites and tests to update.
- `STUB_MARKER|STUB_ANSWER` in `apps/mastra/src` — the safety regression guard
  being replaced.
- `getFirecrawlConfig` in `apps/mastra/src` — optional-config accessor pattern.
- `fetchImpl` in `apps/mastra/src/services` — injectable-fetch test pattern.
- `registerApiRoute` in `apps/mastra/src` — route-isolation test that must keep
  passing.

## What To Build

1. `apps/mastra/src/services/jesusfilm-rag-client.ts` — typed HTTP client for
   `POST {base}/v1/search` following `firecrawl-client.ts` conventions: bearer
   header, strict request body `{ query, policy? }` (the contract rejects
   unknown fields), Zod-parse the response envelope
   `{ results: [{ chunkId, score, text, ord, tags, citation: { sourceKey, sourceName, title, url } }] }`,
   typed failure union (`config_missing`, `auth_failed`, `network_error`,
   `rejected`, `parse_error`, ...), explicit timeout sized to tail latency
   (RAG's own reference client uses a 5s ceiling; typical is ~0.8–1.4s).
   Single attempt per call — do NOT copy firecrawl-client's retry/backoff
   loop. Do not pass the BCP-47 locale hint straight into `policy.language`:
   the RAG filter is an exact match on bare codes (`"en"`), so normalize or
   omit it.
2. `apps/mastra/src/config/env.ts` — new `.optional()` env vars for the RAG
   base URL and bearer token (+ optional timeout override) and a
   `getJesusfilmRagConfig()`-style accessor, plus an allowed-hosts guard on
   the base URL mirroring the existing Firecrawl/AI-Gateway pattern. Zero new
   required env vars.
3. Rewire `apps/mastra/src/mastra/tools/retrieve-answer.ts` — `execute` calls
   the client; output becomes passage-shaped
   `sources: [{ text, sourceName, title, url, score }]` plus a status the agent
   can act on (ok / empty / unavailable). Remove the stub answer; the tool
   generates nothing. Removing `answer` is a breaking change to the exported
   `.strict()` output schema — update the stub's tests and any consumer of the
   old shape in the same change.
4. Update `apps/mastra/src/mastra/agents/seeker-agent.ts` instructions:
   synthesize from returned passages, cite source name + URL, never cite a
   source name or URL not present in the current tool result, say plainly when
   no grounded answer exists or retrieval is unavailable.
5. `apps/mastra/.env.example` — add the new variables.
6. Tests colocated with the client and tool: mocked-fetch client tests using
   the real contract shapes (mocked-shape vs real-contract discipline — fixture
   payloads copied from the published contract, not invented), a safety guard
   replacing the `STUB_MARKER` test (no invented citations; sources only from
   RAG responses), unconfigured-degradation test (AE1).
7. `apps/mastra/CLAUDE.md` — update the "Seeker agent" section: retrieval is
   now real, config vars, unconfigured behavior.

## Constraints

- No new required env vars — unconfigured means graceful degradation, never a
  boot failure (KTD5 continuation).
- No tool-side LLM call. The tool retrieves; the agent generates.
- Do not import from or vendor the jesusfilm-rag repo; the integration surface
  is the published HTTP contract only.
- Studio-only remains: no new `registerApiRoute` exposure; route-isolation test
  keeps passing.
- Token issuance (an entry in the RAG service's `SERVE_BEARER_TOKENS`) is an
  ops step outside this repo — code must merge cleanly before it exists.
  Request the all-sources (`*`) scope: a source-scoped token returns silent
  empty results outside its scope and won't see newly indexed sources.
- Prod corpus currently has one indexed source (`starting-with-god`); do not
  block on corpus coverage.
- Relevance-threshold tuning and weak-passage decline behavior are deferred to
  the guardrail gate — do not add minScore overrides or weak-passage heuristics
  here.

## Verification

- `pnpm --filter @forge/mastra typecheck` and `pnpm --filter @forge/mastra test`
  pass.
- With env vars unset: `MASTRA_STORAGE_BACKEND=memory pnpm --filter @forge/mastra dev`
  boots; the tool returns an explicit unavailable result in Studio.
- With a real token + URL configured: a factual question in Studio fires
  `retrieveAnswer`, real passages return from the RAG, and the agent's reply
  cites source names and URLs, all of which appear in the returned passages
  (AE2).
- An off-corpus question yields an honest "no grounded answer" with zero
  fabricated sources (AE3).
