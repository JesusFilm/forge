---
id: "feat-431"
title: "Port RAG acquisition, ingestion, and maintenance"
owner: "jaco"
priority: "P0"
status: "complete"
start_date: "2026-09-18"
duration: 5
depends_on: ["feat-430"]
blocks: ["feat-432", "feat-445", "feat-446", "feat-452"]
tags: ["rag", "acquisition", "indexing"]
---

## Problem

After preserving the corpus, Forge must own the mechanisms that maintain it. Historical scope: [jfrag #164](https://github.com/JesusFilm/jesusfilm-rag/issues/164).

## Entry Points — Read These First

1. `JesusFilm/jesusfilm-rag/src/acquisition/`, `JesusFilm/jesusfilm-rag/src/ingestion/`, and `JesusFilm/jesusfilm-rag/src/registry/` — source discovery, extraction, normalization, chunking, and registry implementations.
2. `JesusFilm/jesusfilm-rag/scripts/acquire-production.ts`, `JesusFilm/jesusfilm-rag/scripts/index-production.ts`, `JesusFilm/jesusfilm-rag/scripts/language-sweep-production.ts`, and `JesusFilm/jesusfilm-rag/scripts/source-status.ts` — production maintenance entry points to port.
3. `apps/rag/AGENTS.md` — lane ownership, write boundaries, and production rules.

## Grep These

- `acquire-production`
- `index-production`
- `source-status`
- `idempotent`

## What To Build

Port acquisition, staging, normalization, chunking, embedding, indexing, and source-scoped maintenance commands.

## Constraints

- Only indexing writes corpus rows.
- Preserve source-scoped idempotence and embedding-model provenance.

## Verification

- Fake-based unit tests and real-adapter integration tests pass.
- Dry-run and explicit-target safeguards cover every production command.

## Resolution

Implemented in [Forge PR #2093](https://github.com/JesusFilm/forge/pull/2093).

Post-review hardening added transactional language-change audit rows, the
missing document update timestamp, model-specific index-attempt state, safe
fresh-snapshot force selection, bounded-sweep refusal, source-scoped redirect
and sitemap destination checks, private-address rejection, and consistent
CDATA decoding. The migration and adapter behavior were verified against a
clean disposable PostgreSQL database.

The final review-fix pass made deferred-source acquisition state executable,
validated Firecrawl's provider-reported final URL against source policy,
committed document replacement and model-attempt state atomically, and required
explicit source-scoped limits for production maintenance writes. The direct
HTTP DNS-rebinding residual risk and its expansion triggers are recorded in the
operator runbook. Broader registry-test consolidation and typed-error cleanup
continue in `feat-445` and `feat-446`.

Migration audit recovery of the omitted source-scoped raw-document promotion
path is tracked by `feat-452`.
