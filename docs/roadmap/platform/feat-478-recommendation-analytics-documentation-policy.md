---
id: "feat-478"
title: "Remove recommendation and analytics consent prerequisites from documentation"
owner: "nisal"
priority: "P0"
status: "complete"
start_date: "2026-09-10"
completed_date: "2026-09-10"
duration: 1
depends_on: []
blocks: []
tags: [web, recommendations, analytics, documentation]
---

## Problem

Plans and future tickets still require consent before recommendation learning or
analytics can run. These instructions conflict with the September 10 product
decision and can reintroduce the Watch analytics outage fixed in PR #2229.

## Entry Points - Read These First

1. `docs/analytics-and-recommendation-policy.md` - current enablement decision and
   required Watch analytics coverage.
2. `AGENTS.md`, `CLAUDE.md`, and `CONCEPTS.md` - agent guidance and terminology.
3. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md`
   and `docs/plans/2026-08-28-2331-fix-watch-ga4-measurement-plan.md` - active plans.
4. `docs/roadmap/content-discovery/`, `docs/observability/datadog.md`, and
   `docs/roadmap/topic-experiences/feat-444-watch-ga4-measurement.md` - downstream
   work and operations guidance.

## Grep These

- `consent|consensual|consenting|Essential.only`
- `privacy.*gate|sign.off|approved consent`
- `GoogleAnalytics|DatadogRum`

## What To Build

Remove consent prerequisites from current recommendation and analytics guidance.
Explicitly preserve environment-configured GA page views, navigation, Watch
events, and Datadog RUM. Mark historical implementation and research material
as superseded where it could otherwise prescribe a consent requirement.

## Constraints

- Documentation only; retain actual runtime API/type names and incident facts.
- Preserve explicit personalization controls, deletion, retention, integrity,
  authentication, and authorization requirements.
- Work in an isolated worktree; leave other agents' drafts untouched.

## Verification

- Review every remaining in-scope consent reference as a runtime identifier,
  historical fact, external-source description, or explicit removal instruction.
- Check changed Markdown formatting, local links, and YAML frontmatter.
- Review for contradictory defaults and confirm the analytics preservation rule
  reaches active plans, roadmap tickets, runbooks, and agent guides.

## Resolution

Added one enablement policy and linked it from the root/Web guides, recommendation
plans and tickets, GA4 migration and route-telemetry work, observability runbooks,
and incident learnings. Current requirements use configured defaults; historical
consent implementation and research records explicitly defer to this policy.
The restored Watch analytics coverage is a requirement for future changes.

Verified changed Markdown, 34 YAML documents, new local references, preserved
roadmap dependency edges, roadmap lint, and hidden-lane checks. The review retained
explicit viewer controls, integrity, retention, erasure, and authentication.
This change edits documentation only; PR #2229 contains the runtime fix and its
production receipt evidence.
