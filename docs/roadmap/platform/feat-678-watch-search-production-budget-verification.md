---
id: "feat-678"
title: "Validate Watch search production budget and alerts"
owner: "vlad"
priority: "P1"
status: "not-started"
start_date: "2026-10-09"
duration: 2
depends_on:
  - "feat-657"
blocks: []
tags:
  - "platform"
  - "watch"
  - "search"
  - "latency"
  - "observability"
---

## Problem

FGE-29 asks for representative production p95 below two seconds, correct
hard-budget behavior, and percentile monitoring and alerts. feat-657 supplies
public MODERN and DEFAULT request deadlines with controlled dependency and Yoga
HTTP tests. A healthy browser probe establishes routing, not those production
SLOs. FGE-29 remains partially addressed until the normal PR-to-main deployment
and remaining acceptance are verified. This follow-up records existing issue
requirements; it does not authorize deployment shortcuts or production stress.

## Entry Points — Read These First

- `apps/admin/src/services/typesense-watch-search.service.ts` —
  `searchResolvedTypesenseWatchSearch`, `withinStage`, and query-free deadline
  logging for the canonical MODERN primary.
- `apps/admin/src/services/watch-search-request-deadline.ts` — strict
  request-start deadline and remaining budget.
- `apps/admin/src/services/watch-search.service.ts` — DEFAULT deadline and
  lane degradation.
- `apps/admin/src/graphql/queries/watch-search.ts` — primary selection, typed
  `WATCH_SEARCH_TIMEOUT`, and trace enqueue after completed responses.
- `apps/admin/src/services/search-trace.service.ts` and
  `apps/admin/src/services/search-trace-privacy.ts` — existing trace metrics,
  privacy handling, and retention; timeout errors currently have no completion
  trace.
- `apps/admin/src/graphql/queries/watch-search.yoga.test.ts` and
  `apps/admin/src/services/typesense-watch-search.service.test.ts` —
  controlled deadline contracts.
- `apps/web/src/lib/watch-search-client.ts` — caller timeout and server-error
  classification.
- `docs/analytics-and-recommendation-policy.md` — preserve existing configured
  GA and Datadog integrations and privacy rules.
- `docs/roadmap/platform/feat-657-watch-search-hard-request-deadline.md` —
  implementation evidence and limits.

## Grep These

- `watch_search_deadline_exceeded`, `request_budget_exceeded`,
  `WATCH_SEARCH_HARD_TIMEOUT_MS`, `remainingBudgetMs`.
- `enqueueWatchSearchTrace`, `latencyMs`, `classifyLatencyBucket`,
  `laneStatuses`, `searchMode`.

## What To Verify

- After the normal PR-to-main deployment, record the deployed revision and
  serving mode. Confirm canonical Origin traffic exercises MODERN and document
  DEFAULT separately rather than mixing populations.
- Agree on a stable representative query matrix across English, Latin-script
  multilingual, Cyrillic, Arabic, Devanagari, and Han classes. Preserve the
  issue's historical Arabic and Portuguese examples as regression cases;
  include fast exact titles. Query strings may live in reviewed test fixtures,
  never metric labels or telemetry payloads added by this follow-up.
- Prefer existing production telemetry over extra traffic. Report sample size,
  window, server versus browser timing, path, script class, and degraded/error
  outcomes. Evaluate p50/p95/p99 and the agreed p95 below two-second target;
  neither a trivial healthy probe nor a small sample proves it.
- Ensure skipped or timed-out optional stages are represented as degraded and
  hard failures remain explicit. Distinguish embedding latency, database
  latency, and service saturation using existing bounded diagnostics.
- Establish actionable monitoring and alerting for deadline errors as well as
  completed responses. Use bounded low-cardinality categories for path, script,
  degraded reason, and result count. Do not add raw queries, request IDs,
  content IDs, user IDs, tokens, cookies, IP addresses, or other PII/identifiers
  to metrics. Review any telemetry additions against the existing privacy and
  retention policy.

## Constraints

- No production mutation, artificial fault injection, load/stress run, or
  direct deployment from a local worktree. Production changes use the normal
  reviewed PR-to-main flow; controlled faults run locally or in an authorized
  isolated staging environment.
- Keep feat-657 deadline code and native ranking unchanged unless new evidence
  demonstrates a defect. Preserve direct shadow/evaluation caller behavior.
- Preserve configured Watch GA and Datadog integrations. Do not infer a new
  consent prerequisite or add query/identifier labels.
- Do not claim Prisma cancellation or Cloudflare timeout passthrough from a
  Yoga-only test. State the evidence boundary explicitly.

## Safe Verification

- Read-only revision/config/telemetry inspection first; any browser checks use
  a bounded sequential representative smoke with actual URLs and recorded
  transport status, without automated production load.
- Exercise stalled dependencies, deadline counters, script categorization,
  and upstream-failure distinctions with controlled local fixtures; include
  a test proving raw queries and identifiers cannot become metric labels.
- If telemetry/code changes are needed, run affected tests, typecheck, lint,
  formatting, and required schema/codegen checks before pushing.
- Publish an evidence ledger that distinguishes verified deadline behavior,
  measured percentile outcomes, sample limitations, and remaining blockers.
  Update FGE-29 only to the state supported by that evidence; this ticket is
  not started and makes no production performance or alert-delivery claim.
