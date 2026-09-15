---
id: "feat-501"
title: "Plan formal RAG consumer access and usage visibility"
owner: "jaco"
priority: "P1"
status: "in-progress"
start_date: "2026-09-15"
duration: 1
depends_on: []
blocks: ["feat-502", "feat-503"]
tags: ["rag", "planning", "auth", "observability"]
---

## Problem

J006's proposed integration identity and usage visibility need an actionable
Forge plan and independently verifiable delivery records.

## Entry Points — Read These First

1. `docs/roadmap/rag/CLAUDE.md` — hidden lane and resolution conventions.
2. `apps/rag/src/serving/http/auth.ts` — current bearer-to-scope map.
3. `docs/plans/2026-09-15-001-feat-rag-consumer-access-usage-plan.md` — full scope.

## Grep These

`TokenRegistry`, `lookupScope`, `SERVE_BEARER_TOKENS`, `createApp`.

## What To Build

Deliver documentation only: registration, lifecycle, HTTP identity, separately
tracked observable reporting, synthetic RAGBot release proof, pending decisions,
and proposed wiki note if the transactional writer is unavailable.

## Constraints

No implementation, credentials, production evidence, source import, or deployment.
A completed planning record does not complete its implementation dependents.

## Verification

Format changed Markdown; validate frontmatter, new IDs, reciprocal dependencies,
relative links, lane counts and hidden-lane CI checks. Review coverage against J007.
