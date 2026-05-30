---
title: "Offline workflow batches must respect consumer write limits"
date: "2026-05-26"
category: "integration-issues"
module: "apps/mastra"
problem_type: "integration_issue"
component: "service_object"
symptoms:
  - "A default all-source offline generation run can produce more rows than the downstream write route accepts"
  - "The producer workflow passes local tests with small fixtures but fails against the real HTTP contract at normal defaults"
root_cause: "wrong_api"
resolution_type: "code_fix"
severity: "medium"
tags:
  - "mastra"
  - "admin"
  - "batching"
  - "api-contract"
  - "search-eval"
---

# Offline workflow batches must respect consumer write limits

## Problem

Mastra's eval query generation workflow combined catalog-derived, locale-quality, and trace-sampled candidates before writing them to Admin. The Admin write route intentionally accepts at most 100 generated candidates per request, but the workflow defaults could exceed that limit.

## Symptoms

- A default run can generate `30 catalog + 60 locale_quality + 25 trace = 115` candidates.
- Admin's `POST /api/internal/search-eval/candidates` route rejects batches larger than 100.
- Small unit fixtures with one or two candidates pass, masking the default-path failure.

## What Didn't Work

- Only bounding each source family independently. Per-source caps still allow the combined output to exceed the consumer route's batch contract.
- Raising the Admin route limit. The route limit is a safety boundary for JSON size, validation cost, and operator-controlled write surfaces; relaxing it would make the consumer less defensive.
- Reducing default generation counts. That avoids one current total but leaves the next source or locale-count change exposed.

## Solution

Keep the Admin route's bounded contract and make the producer workflow chunk writes at the consumer limit:

```ts
const MAX_CANDIDATE_STORE_BATCH_SIZE = 100

for (
  let offset = 0;
  offset < candidates.length;
  offset += MAX_CANDIDATE_STORE_BATCH_SIZE
) {
  const batch = candidates.slice(
    offset,
    offset + MAX_CANDIDATE_STORE_BATCH_SIZE,
  )
  const storeResult = await client({
    payload: { candidates: batch },
    // same URL, bearer, timeout, and fetch wiring as the single-call path
  })
  if (!storeResult.ok) return adminFailure(storeResult, "store")

  totals.storedCount += storeResult.result.storedCount
  totals.skippedCount += storeResult.result.skippedCount
}
```

The workflow result still reports the total generated, stored, skipped, and source-count numbers, but no single HTTP request exceeds Admin's batch limit.

Add a regression test that generates 101 locale-quality candidates and asserts two writes: one batch of 100 and one batch of 1. This catches future source-count changes that would otherwise reintroduce the mismatch.

## Why This Works

The producer owns fan-out shape and the consumer owns per-request safety limits. Chunking lets each side keep its responsibility: Mastra can generate as many staged candidates as the workflow asked for, while Admin keeps bounded request validation and storage work.

This is the same producer-consumer contract discipline as report-file and provider-batch patterns: tests should exercise the real boundary limit, not only tiny happy-path fixtures.

## Prevention

- When an offline workflow aggregates multiple source families, compute the maximum combined output against the downstream route's request limit.
- Put the consumer's write limit in a producer-side chunking constant and cover `limit + 1` in tests.
- Keep the route's body-size and item-count checks defensive even if the only current caller is trusted.
- Report aggregate totals across chunks so operators see one workflow outcome, not per-batch implementation detail.

## Related Issues

- [Mocked shape vs. real contract discipline](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md)
- [Producer-consumer report-file contract pattern](../best-practices/producer-consumer-report-file-contract-pattern-20260506.md)
- [Batched provider call with input-position-stable output contract](../best-practices/batched-provider-input-position-stable-contract-20260505.md)
