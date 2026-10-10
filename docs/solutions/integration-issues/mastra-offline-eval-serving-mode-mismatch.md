---
title: Mastra offline evaluation labels must not become Serving modes
date: 2026-08-17
category: integration-issues
module: mastra_offline_search_eval
problem_type: integration_issue
component: service_object
symptoms:
  - Candidate baseline capture fails with an Admin 400 response
  - The Serving endpoint reports Invalid Serving search eval input
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags: [mastra, search-eval, candidate-search, serving, baseline]
---

# Mastra offline evaluation labels must not become Serving modes

## Problem

Mastra baseline capture failed after Candidate evaluation moved to the fixed production Serving endpoint. The evaluator forwarded its reporting lens, such as `keyword-first` or `hybrid`, as the endpoint's runtime `mode`, so Admin rejected the request before search ran.

## Symptoms

- `/forge-offline-search-eval` returns `admin_read_rejected` while capturing a Candidate baseline.
- Admin returns HTTP 400 with `Invalid Serving search eval input`.
- Direct Candidate and public search requests remain healthy because the fault is in the Mastra-to-Admin evaluation adapter.

## What Didn't Work

- Retrying the baseline capture did not help because every prompt used the same invalid request shape.
- Treating evaluation lenses as interchangeable server modes conflicted with the Serving route's deliberate fixed-profile contract.

## Solution

Translate the Mastra request at the Admin adapter boundary:

```ts
payload: {
  query: prompt.queryText,
  locale: prompt.locale,
  mode: "modern",
}
```

The Serving route accepts only `modern` (`apps/admin/src/app/api/internal/search-eval/serving-search/route.ts:16`). The adapter now sends that value (`apps/mastra/src/services/offline-search-eval/runner.ts:359`) while the report metadata continues to record the requested evaluation lens (`apps/mastra/src/services/offline-search-eval/runner.ts:852` and `apps/mastra/src/services/offline-search-eval/runner.ts:980`).

Regression tests assert both halves of the contract: Admin receives `modern`, and reports retain `keyword-first` or `hybrid`.

## Why This Works

The two values answer different questions:

- The Serving `mode` selects the production search implementation and is fixed to Candidate-compatible `modern`.
- The evaluation lens labels the experiment and remains useful in artifacts and comparisons.

Keeping that translation at the outbound adapter prevents reporting terminology from controlling the pinned production profile.

## Prevention

- Treat external request enums as endpoint contracts, not as reusable internal labels with similar names.
- Test the outbound payload and the persisted report metadata separately whenever an evaluator talks to a fixed-profile endpoint.
- Run at least one real baseline capture after deploying changes to either side of the Mastra-to-Admin boundary.

## Related Issues

- [Mastra offline search eval orchestration boundary pattern](../architecture-patterns/mastra-offline-search-eval-orchestration-boundary-pattern.md)
- [Internal diagnostic search modes need mode-aware eval identity](../architecture-patterns/internal-diagnostic-search-modes-need-mode-aware-eval-identity.md)
