---
id: "feat-526"
title: "Plan formal RAG consumer access and usage visibility"
owner: "jaco"
priority: "P1"
status: "complete"
start_date: "2026-09-15"
duration: 1
depends_on: []
blocks: ["feat-527", "feat-528", "feat-530", "feat-518"]
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
tracked observable reporting, synthetic ops HTTP release proof, approved decisions and remaining technical details,
and proposed wiki note if the transactional writer is unavailable.

## Constraints

No implementation, credentials, production evidence, source import, or deployment.
A completed planning record does not complete its implementation dependents.

## Verification

Format changed Markdown; validate frontmatter, new IDs, reciprocal dependencies,
relative links, lane counts and hidden-lane CI checks. Review coverage against J007 and J008.

## Resolution

Planning delivered in [Forge draft PR #2304](https://github.com/JesusFilm/forge/pull/2304).
The plan and separate implementation tickets are complete as documentation;
feat-527 and feat-528 remain not-started. The investigation report includes
validation results and the authorized wiki fallback payload. No implementation
or live release verification was performed.

J008 incorporates the approved authorization, usage, credential and rollout
choices, with portal design now and implementation after dogfood. See
`docs/plans/2026-09-16-j008-investigation-report.md` for evidence and validation.

J022 reconciles portal admission via the PR-maintained portal-user allowlist
with direct authenticated consumer creation and runtime owner membership.
See the [J022 report](../../plans/2026-09-21-j022-portal-reconciliation-report.md).
Discovery evidence and J021 limitations remain in stacked draft #2325;
implementation feat-527–530 remains not-started.
