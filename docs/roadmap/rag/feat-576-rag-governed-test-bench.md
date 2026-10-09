---
id: "feat-576"
title: "Enable governed RAG test-bench queries and dedicated consumer usage"
owner: "jaco"
priority: "P1"
status: "not-started"
start_date: "2026-09-30"
duration: 5
depends_on: ["feat-620"]
blocks: []
tags:
  [
    "rag",
    "portal",
    "auth",
    "observability",
    "infrastructure",
    "ready-for-agent",
  ]
---

## Problem

The manual's disabled sample bench cannot verify a consumer's query. Enabling it
without a dedicated consumer, server-held token, kill switch, and hard resource
limits would obscure usage and risk competing with normal retrieval traffic.

## Entry Points — Read These First

1. [Execution spec](../../plans/2026-09-30-002-rag-governed-test-bench-spec.md) — complete behavior, variable/default table, activation sequence, and acceptance cases.
2. [feat-620](feat-620-rag-consumer-manual.md) and its approved mockup — UI to enable; remove the synthetic output when implementing this ticket.
3. `apps/rag/src/serving/http/{portal.ts,portal-consumers.ts,app.ts,auth.ts,usage.ts}` — portal admission/origin checks, registered-consumer authentication, source intersection, and request accounting.
4. `apps/rag/src/contracts/{consumer-access.ts,consumer-usage.ts,deadline.ts,ports.ts}`, `apps/rag/src/retrieval/retrieve.ts`, `apps/rag/src/adapters/postgres/index.ts` — bounded work and cancellation through existing seams.
5. `apps/rag/src/config/`, `apps/rag/src/main.ts`, `apps/rag/scripts/serve.ts` — validated environment configuration and dependency injection.
6. `apps/rag/portal/users.json`, `apps/rag/docs/ops/consumer-access-migration.md`, `consumer-usage.md`, and `environment-and-secrets.md` — Jaco's admitted identity, issuance/rotation, usage proof, and fixed Railway target.
7. `apps/rag/tests/consumer-http-lifecycle.integration.test.ts`, `apps/rag/src/serving/http/usage.test.ts`, `apps/rag/src/adapters/postgres/consumer-usage.integration.test.ts`, and portal browser tests — existing high-level test boundaries.

## Grep These

`authenticate`, `authenticatedConsumer`, `resolveScope`, `UsageCollector`,
`withDeadline`, `fetchDocumentTexts`, `candidateTopK`, `statement_timeout`,
`RAG_DEFAULT_CONSUMER_SOURCE_KEYS`, `origin_invalid`, `rag_`, `jaco-brink`.

## What To Build

- Enable the manual's bench only when the server reports valid enabled capability;
  remove sample results from runtime assets and show idle/real output states.
- Add a same-origin authenticated portal query route, proposed
  `POST /portal/manual/query`, with current admission and origin protection.
  It must use the dedicated runtime consumer bearer through the existing `/v1/search`
  authentication, scope and usage path, never a direct unaccounted retriever call.
- Create the `test-bench` consumer through the existing management flow with Jaco
  (`jaco-brink`, resolve current immutable GitHub identity) as owner. Configure its
  active token as Railway `RAG_TEST_BENCH_API_TOKEN`; no manual UI entry or exposure.
- Implement and document `RAG_TEST_BENCH_ENABLED` plus the retrieval, body-size,
  deadline, rate and concurrency settings in the spec. Enforce limits server-side
  and across replicas, not merely in UI widgets. Bound database/provider work as
  well as returned bytes. Default to disabled and passage-only retrieval.
- Demonstrate attribution to `test-bench` in the existing Usage page, prove
  revocation/rotation and kill-switch behavior, and record redacted rollout evidence.

## Constraints

The planning PR authorizes no Railway mutation, query execution or token creation.
Later operational activation uses the normal merged-code Railway path and the
fixed target in the runbook. Existing consumers retain their own policy/defaults;
bench restrictions apply only to the dedicated bench identity and route.
Missing/invalid configuration disables this capability without breaking the
manual, Consumers, Sources, Usage or ordinary `/v1` traffic. Never accept a browser
supplied token, target URL, or consumer ID for this route. Do not silently truncate
full documents and label them complete. Keep all secrets and corpus text out of
logs, PRs, screenshots and fixtures.

## Verification

- Exercise the portal query HTTP boundary with real local Postgres, synthetic
  consumer credentials and a deterministic embedder; inspect actual Usage reports
  to prove exactly-once attribution of dispatched requests.
- Prove disabled/malformed/missing configuration, expired/removed sessions,
  wrong-origin requests, tampered payloads, revoked credentials, scopes and every
  configured bound fail closed before expensive work where possible.
- Prove distributed rate/concurrency admission, cancellation and database deadlines
  actually release resources. A frontend timer or promise race alone is not proof.
- Run the full applicable RAG package/HTTP/adapter/browser checks and measured
  page-load/performance comparison. No load testing against production.
- Activate only after a bounded owner-approved smoke proves consumer ownership,
  usage visibility, kill switch and secret handling. Record only names, identifiers,
  counts, timing, deployment and outcomes. See the spec for exact gates.

## Delivery scope

Implementation depends on feat-620. This entry preserves the explicitly deferred
work; neither publication of the spec nor mockup approval enables the test bench.

Specs and roadmap publication: [#2485](https://github.com/JesusFilm/forge/pull/2485). The implementation status remains not started.
