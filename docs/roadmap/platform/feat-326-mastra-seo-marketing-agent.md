---
id: "feat-326"
title: "Add Mastra SEO marketing agent and Manager workspace"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-08-01"
duration: 21
depends_on:
  - "feat-324"
blocks: []
tags:
  - "platform"
  - "mastra"
  - "manager"
  - "admin"
  - "seo"
  - "search-console"
  - "analytics"
---

## Problem

Forge can author localized Watch and Experience content, but it has no durable
loop connecting Google Search performance, on-site behavior, observed page
state, a proposed improvement, human approval, objective activation, and a
later outcome. Existing update paths can affect canonical content, so an SEO
agent must remain read-only and materialize approved editorial work as a draft
rather than publishing it.

## Entry Points — Read These First

1. `docs/plans/2026-08-01-001-feat-mastra-seo-marketing-agent-plan.md` — reviewed implementation plan and safety boundaries.
2. `apps/mastra/src/mastra/index.ts` — agent, workflow, schedule, and service-route registration.
3. `apps/mastra/src/services/firecrawl-client.ts` — bounded external-provider pattern.
4. `apps/admin/prisma/schema.prisma` — `ContentRevision` draft lifecycle and durable data authority.
5. `apps/manager/src/features/shell/manager-shell.tsx` — authenticated top-level Manager navigation.

## Grep These

- `ContentRevision`
- `webmasters.readonly`
- `analytics.readonly`
- `seoMarketingAgent`
- `SeoProposal`
- `manual_reconcile`
- `ManagerRole.OPERATOR`

## What To Build

1. Add an Admin-owned SEO Experiment Ledger for evidence, immutable proposals,
   decisions, draft/ticket materialization, activation, evaluation, rollback,
   and reviewed lessons.
2. Add bounded read-only GSC, GA4, Firecrawl/page, and grounded web-search
   observations to Mastra, plus a reusable SEO Marketing Agent and default-off
   scheduled workflows.
3. Add `/dashboard/seo` in Manager for action-first proposal, experiment,
   learning, and reconciliation review.
4. Require interactive, replay-protected approval. Approved editorial changes
   become AI-attributed Admin drafts; approved engineering briefs enter a
   fenced ticket outbox. Neither path publishes or deploys.
5. Start measurement only after an objective production probe matches the
   immutable treatment, keep interim and final evaluations distinct, and
   generate approval-required rollback proposals from the pre-change snapshot.

## Constraints

- GSC is authoritative for Google Search performance; GA4 is a guardrail;
  crawler/browser evidence and grounded LLM responses are observations.
- Missing rows are unknown, not zero. Direct HTTP checks are not indexing proof.
- Mastra tools are read-only. Manager/Mastra never receive publish authority.
- External content is untrusted data. Enforce minimization, allowlisted egress,
  signed narrow service assertions, and bounded retention outside the model.
- Keep Watch contextual identity separate from its standalone search canonical.

## Verification

- Admin migration, service, auth, permission, GraphQL, and generated-contract
  checks pass without changing canonical content on proposal approval.
- Mastra provider, tool, agent, workflow, schedule, registration, and route-auth
  checks pass with optional providers unavailable.
- Manager route/auth, adapter, presenter, accessibility, and responsive browser
  smoke pass for approval, conflict, insufficient-data, and unavailable states.
- A dry-run records would-propose work with zero proposal/materialization/ticket
  writes, and repeated live runs remain idempotent.
