---
id: "feat-569"
title: "Production source catalog in the RAG portal"
owner: "jaco"
priority: "P1"
status: "complete"
start_date: "2026-09-29"
duration: 2
depends_on: []
blocks: []
tags: [rag, portal, sources, dashboard]
---

## Problem

The public source ledger lists domain-specific ingestion keys independently, making multilingual brands hard to inspect. Portal users need a production-only catalog grouped by content brand without changing ingestion, source keys, retrieval policy, filtering, or citations.

## Entry Points — Read These First

1. `docs/plans/2026-09-29-rag-portal-sources.md` — confirmed design and implementation scope.
2. `apps/rag/src/serving/http/portal.ts` and `portal-assets/` — admitted session routes and existing portal shell.
3. `apps/rag/dashboard/compiled-data.json` — committed production inventory and observation timestamp.
4. `plugins/jfp-rag/skills/status-dashboard/SKILL.md` — existing snapshot-to-PR refresh workflow.
5. `apps/rag/scripts/lib/dashboard/types.ts` — input snapshot shape.

## Grep These

`createPortal`, `data-section`, `fetched_at`, `observed`, `declaredLanguages`, `portalSources`.

## What To Build

Add top-level Sources with a facade grouping existing keys by explicit content-brand membership. Show production documents only. List brand, total documents, detected language count, and domain/count; details show overview and searchable paginated language coverage with contributing domains. Mark unexpected detected languages and expose unidentified-language counts. Provide source/domain search and a searchable catalog language filter. Use the existing committed snapshot, retaining its production observation time and the existing public page.

## Constraints

No corpus writes, registry rekeys, public `/v1` changes, retrieval/filter changes, eval workflow changes, live polling, new access roles, or production refresh. Do not display lifecycle/eval states, proposed/retired sources, review queues, or ingestion notes. Group identities are display-only and must never enter consumer source configuration. Preserve authenticated admission and strict CSP. Keep source UI/data off the Consumers initial request path.

## Verification

Run focused facade/HTTP tests, portal browser checks including 250+ languages and mobile, page-load/resource comparisons, RAG typecheck/lint/depcruise/status checks, and touched-file formatting. Verify document/language totals against the committed snapshot; verify public artifacts are unchanged. Record local evidence and limitations before completing the ticket.

## Resolution

Implemented in [Forge PR #2463](https://github.com/JesusFilm/forge/pull/2463).
Sources is an authenticated, production-only display facade over the committed
snapshot, with explicit brand memberships and searchable language/domain detail.
Existing ingestion keys, retrieval/filtering/citations, evaluation workflow and
public Pages artifacts are unchanged.

[Local verification](evidence/feat-569/local-verification.md) records 903 passing
package tests, five passing browser tests, desktop/mobile inspection, and deferred
Sources loading with no additional initial requests. Package and repository
format checks pass. PR merge, deployment and live acceptance remain pending.
