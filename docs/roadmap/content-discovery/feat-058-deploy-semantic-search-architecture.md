---
id: "feat-058"
title: "Deploy Semantic Search Architecture"
owner: "tataihono"
priority: "P1"
status: "not-started"
start_date: "2026-07-01"
duration: 31
depends_on:
  - "feat-011"
  - "feat-012"
  - "feat-045"
blocks:
  - "feat-063"
tags:
  - "search"
  - "infrastructure"
  - "web"
---

## Problem

Q2 search work lays the foundation, but the platform still needs a production-grade deployment story for semantic search across indexing, query serving, monitoring, and client rollout. This ticket turns the search architecture from a feature set into an operated capability.

## Entry Points — Read These First

1. `docs/roadmap/content-discovery/feat-009-pgvector-embedding-indexing.md` — storage/indexing foundation
2. `docs/roadmap/content-discovery/feat-010-semantic-search-api.md` — API contract
3. `docs/roadmap/content-discovery/feat-011-search-ui-web.md` — web consumer
4. `docs/roadmap/content-discovery/feat-012-search-ui-mobile.md` — mobile consumer
5. `docs/roadmap/content-discovery/feat-045-pipeline-integration.md` — indexing of newly uploaded videos
6. `apps/manager/src/services/embeddings.ts` — embedding model assumptions

## Grep These

- `vector` in `docs/roadmap/content-discovery/`
- `search` in `apps/web/src/`
- `embeddings` in `apps/manager/src/services/`
- `database` in `apps/cms/config/`

## What To Build

1. Define the rollout plan for search indexing, API scaling, observability, and failure handling.
2. Confirm fresh uploads, backfills, and query traffic all operate within acceptable latency and cost targets.
3. Decide how search is exposed by default in web and mobile once the stack is production-ready.
4. Add the operational checks needed to keep search healthy after launch.

## Constraints

- Do NOT treat the deployed system as done if backfill and fresh-ingest paths diverge.
- Prefer one operational model for embeddings and search over separate ad hoc scripts.
- Keep launch criteria explicit so rollout can be gated by real health checks.

## Verification

- New uploads become searchable through the production pipeline
- Web and mobile search consumers hit a deployed API path successfully
- Index freshness, latency, and error signals are visible to operators
