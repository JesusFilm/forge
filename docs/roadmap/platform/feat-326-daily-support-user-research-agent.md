---
id: "feat-326"
title: "Add daily support and user research agent"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-08-01"
duration: 14
depends_on: []
blocks: []
tags:
  - "platform"
  - "mastra"
  - "support"
  - "user-research"
  - "watch-page"
---

## Problem

New Help Scout conversations contain bug reports, usability friction, and unmet user needs, but the evidence must currently be noticed, reproduced, clustered, and converted into product work manually. Repeated signals can remain isolated across tickets, and support staff spend time on research and triage that a bounded AI workflow can cover safely.

## Entry Points — Read These First

1. `docs/plans/2026-08-01-001-feat-support-research-agent-plan.md` — approved first-release behavior, safety boundaries, implementation units, and validation.
2. `apps/mastra/AGENTS.md` and `apps/mastra/CLAUDE.md` — Mastra runtime, outbound-client, persistence, and deployment conventions.
3. `apps/mastra/src/mastra/workflows/youtube-ai-christian-discovery.ts` — existing daily schedule and report pattern.
4. `docs/solutions/conventions/single-service-http-client-result-union-convention.md` — outbound integration contract.

## Grep These

- `dailySupportResearchWorkflow`
- `supportResearchAgent`
- `SUPPORT_RESEARCH_ENABLED`
- `support_research`
- `Needs validation`

## What To Build

1. Add a default-off daily Mastra workflow that reads newly created conversations from configured Help Scout mailboxes without mutating Help Scout.
2. Sanitize and minimize support content before model use or persistence, exclude attachments, and restrict validation to bounded read-only checks against configured public Watch hosts.
3. Preserve one durable observation per source, cluster recurring usability themes, and distinguish directly confirmed bugs from credible reports that still need human validation.
4. Create budgeted, deduplicated Linear issues through a durable outbox and create one concise daily summary in the configured support-insights project when relevant findings exist.
5. Persist a safe daily report for complete, partial, disabled, and failed runs and expose dry-run operation through authenticated Mastra Studio.

## Constraints

- Help Scout is strictly read-only in v1; no reply, note, tag, assignment, or status mutation.
- Never persist raw support bodies, customer profiles, attachments, secrets, or unsanitized personal data.
- The model has no tools and cannot select URLs, Linear identifiers, priority, assignee, or side effects.
- No customer communication, product code changes, deployment, or automated prioritization.
- Missing integration configuration must not prevent Mastra from booting.
- Production release follows the normal PR-to-main flow and starts disabled.

## Verification

- Focused tests cover pagination/cursors, redaction, prompt injection, URL validation, clustering thresholds, duplicate reconciliation, budgets, partial runs, and disabled/dry-run behavior.
- `@forge/mastra` test, typecheck, lint, and build pass.
- Authenticated Studio shows the registered agent and workflow, and a dry run performs no Help Scout or Linear mutation.
- Review confirms generated descriptions separate reported evidence, automated checks, and model inference.

## Resolution

Implemented the default-off Help Scout support-research pipeline in Mastra with
sanitization, bounded public Watch validation, durable observations and theme
clustering, PostgreSQL outbox dispatch, per-UTC-day Linear budgets, retention,
daily reporting, and a `05:00 UTC` schedule.

Validation completed on 2026-08-01:

- `@forge/mastra`: 474 test suites passed; 1,617 tests passed and 3 remained intentionally pending.
- Typecheck, ESLint, formatting, diff checks, and the production Studio build passed.
- PostgreSQL 16 smoke passed for migration, observation deduplication, five-per-day reservation, finalization, and retention minimization.
- Mastra Studio showed the registered agent and workflow. A disabled dry run completed successfully with zero fetched sources or external actions and no browser console errors.
- Compound code review findings were applied with no residual actionable work.
