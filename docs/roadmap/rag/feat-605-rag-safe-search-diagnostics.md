---
id: "feat-605"
title: "Classify intermittent RAG search failures safely"
owner: "jaco"
priority: "P1"
status: "complete"
start_date: "2026-10-05"
duration: 1
depends_on: []
blocks: []
tags: ["rag", "observability", "security"]
---

## Problem

Intermittent authenticated search failures return HTTP 500 with only
`event=request_failed code=internal`. The same symptom existed before the
environment-name migration. A two-attempt query embedding timeout reproduces
the response in approximately 8.25 seconds, but current logs cannot distinguish
that hypothesis from database/model-check or response-contract failure.

## Entry Points — Read These First

1. `apps/rag/src/serving/http/app.ts` — error boundary and response validation.
2. `apps/rag/src/retrieval/retrieve.ts` — model check, query embedding, vector search and optional document fetch.
3. `apps/rag/src/adapters/embeddings/openai-compatible-embedder.ts` — existing timeout and retry behavior.
4. `apps/rag/src/contracts/search-failure.ts` — closed diagnostic classifications.
5. `apps/rag/src/adapters/embeddings/search-diagnostics.test.ts` — real retrieval/HTTP timeout replay and redaction fixtures.

## What To Build

Record an allowlisted failure stage, category and provider HTTP/transport or
known Prisma code at the existing HTTP error boundary. Generate an opaque
server request ID and return it in `x-rag-request-id` for correlation.
Do not accept client request IDs as log data. Unknown exception properties
must yield a fixed unknown classification.

## Constraints

- Never log raw messages, stacks, causes, names, query/corpus text, SQL, URLs,
  credentials, headers or environment values.
- Preserve HTTP response bodies/statuses, authentication, generic runtime
  variables and embedding timeout/retry settings.
- Preserve historical failure receipts; do not claim a confirmed root cause.
- This change adds diagnostics; it does not fix the intermittent failure.
- No acquisition, indexing, evaluation workflow, corpus writes or provisioning.
- Production publication requires a separately approved normal PR-to-main
  deployment after review of the concrete diagnostic change.

## Verification

- Fail-before/pass-after tests exercise the actual query adapter, retriever
  and HTTP boundary with the two 4-second attempts and 250 ms retry delay.
- Test provider response, network, model/database and response-contract paths;
  assert injected private exception/query data never reaches logs.
- Confirm existing HTTP/auth, retrieval, embedding and usage tests remain green.
- Run package typecheck, lint, import boundaries and formatting.
- After approved deployment, correlate a failed request by opaque ID and safe
  phase/category; until then live diagnosis remains unverified.

## Resolution

Implemented in [PR #2564](https://github.com/JesusFilm/forge/pull/2564), merged at
`b23a445ab08f08294baa2f3675ed8ea7c19884d0` and verified through the normal deployment.
Search failures now emit an allowlisted stage/category/detail and opaque server
request ID; arbitrary provider status text and raw exceptions are omitted.
HTTP bodies/statuses, authentication and embedding retry budgets are preserved.

Local verification passed 935 RAG tests with eight integration tests skipped;
normal hooks and applicable CI, including PostgreSQL integration, passed.
Post-deployment health returned HTTP 200; bounded smoke returned five results;
an authenticated consumer retrieval returned HTTP 200 with three results and a
validated server-generated UUID header. No failure occurred in that check, so
production failure classification was not observed. Classification and redaction
were exercised by local tests. The underlying intermittent failure cause and fix
remain unresolved; this closes instrumentation only.
