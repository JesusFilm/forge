---
id: "feat-518"
title: "Confirm RAG consumer access implementation readiness"
owner: "jaco"
priority: "P1"
status: "complete"
start_date: "2026-09-16"
duration: 2
depends_on: ["feat-511"]
blocks: ["feat-512"]
tags: ["rag", "planning", "auth", "observability"]
---

## Problem

Consumer ownership, GitHub identity, credentials, metadata isolation and aggregate
usage need separate technical discovery. Documentation completion is not runtime
implementation or proof of deployed settings.

## Entry Points — Read These First

1. [Discovery evidence](evidence/feat-518/consumer-access-discovery.md) — current handoffs and labelled historical investigation.
2. [Programme plan](../../plans/2026-09-15-001-feat-rag-consumer-access-usage-plan.md) — canonical J014 accepted policy.
3. `.github/workflows/ci.yml` — existing CI; no consumer-owner validator implemented here.
4. `apps/rag/src/serving/http/auth.ts`, `app.ts`, `scripts/serve.ts` — auth and counting boundary.
5. `apps/rag/prisma/schema.prisma`, `scripts/provision-readonly.ts` — restricted metadata required alongside corpus-reader defaults.
6. `apps/auth/src/auth/config.ts`, `apps/chat/src/auth/oauth-client.ts` — reference patterns only, not deployed GitHub portal proof.

## Grep These

`owners`, `githubUserId`, `ConsumerOwner`, `TokenRegistry`, `usage:report`,
`coverageStatus`, `completeThrough`.

## What To Build

Discovery records the accepted model: any Forge read/write engineer may propose
normal consumer-registration PRs; each entry has nonempty GitHub `owners`;
GitHub authenticates while current merged ownership authorizes management.
A non-owner adds their handle by PR and waits for normal merge. No special
consumer approver or extra human review gate is required.

feat-512 owns narrow owner-validation CI, explicit limits when live organisation
membership cannot safely be checked, stable account binding and trusted merged
revision application/freshness. The earlier option-B approval-enforcement gap,
global engineer/email registry and mutable portal membership are superseded.

RAGBot registers first; later a narrow internal tool provides aggregate usage
only to Jaco/RAGBot. Discovery preserves secure verifier-only credentials,
one-time display, immediate atomic rotation, bounded audit, isolated metadata
roles, exact counts and honest coverage gaps. Exact infrastructure, configuration
and runtime tests remain implementation handoffs, not operational facts.

## Constraints

Documentation only: no product code, settings change, credentials, production/
Railway, corpus/data, deployment or merge. No special consumer approval gate on
any RAG PR. Seven-day migration/cutoff requires separate production approval;
portal follows actual forge-rag-retrieve dogfood. No raw query/IP/token/corpus
telemetry. External consumers/rate limits and retention implementation stay outside scope.

## Verification

Review current requirements against the accepted model and preserve historical
observations as dated evidence. Validate Markdown, frontmatter, relative links,
reciprocal dependencies, lane index/counts and `git diff --check`. Run
`pnpm exec tsx --test scripts/check-hidden-roadmap-lanes.test.ts` and
`pnpm exec tsx scripts/check-hidden-roadmap-lanes.ts`.
Sequence remains feat-511 → feat-518 → feat-512 → feat-513 → feat-514 → feat-515.

## Resolution

Delivered in separate [draft PR #2325](https://github.com/JesusFilm/forge/pull/2325),
branch `docs/rag-consumer-access-discovery`, stacked on planning PR #2304.
J014 reconciles both drafts with the canonical accepted ownership model. The
old review-policy gap is retired; live membership capability and technical
implementation proofs are explicitly unverified. No new checks/settings are
claimed active. Documentation discovery is complete; feat-512–515 remain not-started.
