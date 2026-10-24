---
title: "External-client retry parity in runner fan-out"
problem_type: best_practice
component: tooling
root_cause: missing_workflow_step
resolution_type: code_fix
severity: high
tags:
  - eval-harness
  - semantic-search
  - retry
  - rate-limiting
  - fan-out
  - external-client
  - 429
  - exponential-backoff
  - retry-after
  - silent-data-corruption
  - pLimit
  - admin
date: 2026-05-12
category: best-practices
---

## Problem

When multiple external clients participate in the same runner fan-out (`pLimit(N)`, `Promise.all`, `Promise.allSettled`), they MUST share the same retry contract. If one client retries on transient failures (429, 5xx, transport, timeout) and a peer does not, the non-retrying client's failures get absorbed by the runner's per-item try/catch, downstream steps short-circuit to synthetic defaults, the run reports success, and the persisted data is silently corrupted with no loud error.

This is a property of the **fan-out**, not of any single client. Retry asymmetry across siblings creates a silent-corruption gradient that no individual client owns.

## Symptoms

A run that looks healthy but produces nonsensical data:

- Exit code `0`, JSON report written, no thrown errors in logs.
- Anomalous results: thousands of ties, near-zero net-win-rate, every regression marked "no change."
- Per-item try/catch records `searchError` for the majority of items — visible in the report's per-outcome detail but not surfaced as a run-level failure.
- External-API bills come in unexpectedly low (e.g., judge calls were cheap because they evaluated empty inputs).
- The fan-out reports `succeeded`; downstream consumers treat the run as authoritative.
- Symptom shape: the first ~N items (where N matches the upstream rate-limit window) look correct; the remainder are uniformly empty.
- A subsequent `rebaseline` invocation can persist the corrupted result lists as the new canonical baseline, locking the corruption in.

## What Didn't Work

- **Per-item try/catch in the runner.** The original mitigation in the retired
  Admin search-eval runner absorbed errors gracefully but couldn't inject
  correctness back into the data. It's a safety net, not a retry policy.
- **Lowering default concurrency.** Masks the symptom for small runs but breaks again the moment the upstream rate-limit window or item count changes.
- **Runner-side rate-limit-aware throttling.** Partially helps but admin's limit is per-IP via Redis, so any future change to admin's rate-limit window silently re-breaks it. Throttling at the wrong layer is fragile.

## Solution

**Retry-shape parity:** every external client invoked in the same fan-out
implements the same retry contract. The current search-eval equivalents live in
Mastra's offline judge and Admin HTTP client; the original PR used this
canonical shape:

```ts
const MAX_RETRY_ATTEMPTS = 3
const RETRY_AFTER_CAP_MS = 30_000
const RETRY_BASE_DELAY_MS = 500

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

function parseRetryAfterMs(value: string | null): number | null {
  if (value == null) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, RETRY_AFTER_CAP_MS)
  }
  return null
}

function backoffMs(attempt: number): number {
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), RETRY_AFTER_CAP_MS)
}

async function callWithRetry(
  url: string,
  init: RequestInit,
  {
    timeoutMs,
    maxAttempts = MAX_RETRY_ATTEMPTS,
    logger,
    clientName,
  }: {
    timeoutMs: number
    maxAttempts?: number
    logger: { info: (m: string) => void }
    clientName: string
  },
): Promise<Response> {
  const failures: string[] = []
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: Response
    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "TimeoutError") {
        failures.push(`attempt ${attempt}: timeout after ${timeoutMs}ms`)
        if (attempt < maxAttempts) {
          await sleep(backoffMs(attempt))
          continue
        }
        throw new ClientError(
          "timeout",
          `... after ${maxAttempts} attempts`,
          undefined,
          cause,
        )
      }
      failures.push(`attempt ${attempt}: ${(cause as Error).message}`)
      if (attempt < maxAttempts) {
        await sleep(backoffMs(attempt))
        continue
      }
      throw new ClientError(
        "transport",
        `... after ${maxAttempts} attempts`,
        undefined,
        cause,
      )
    }

    if (
      !response.ok &&
      isRetryableStatus(response.status) &&
      attempt < maxAttempts
    ) {
      const retryAfter = parseRetryAfterMs(response.headers.get("retry-after"))
      const wait = retryAfter ?? backoffMs(attempt)
      logger.info(
        `[search-eval] event=${clientName}.retry attempt=${attempt} status=${response.status} wait_ms=${wait}`,
      )
      await sleep(wait)
      continue
    }

    return response
  }
  throw new ClientError("retry_exhausted", failures.join(" | "))
}
```

Both clients now share: max 3 attempts, Retry-After honored (capped at 30s), exponential backoff (500ms / 1s / 2s) capped at 30s, per-attempt `AbortSignal.timeout`, structured `event=<client>.retry attempt=N status=N wait_ms=N` logs.

400 (validation) is intentionally NOT retryable — a malformed request will never succeed by trying again.

## Why This Works

1. **The runner's try/catch is a safety net, not a retry policy.** A runner
   can correctly continue iterating when one item fails, but it cannot
   distinguish "this query is genuinely empty" from "this request was
   rate-limited and should be retried." Only the client knows.

2. **Retry is the client's responsibility.** External clients own the contract with their upstream: they know which status codes are transient, how to parse `Retry-After`, what timeout is appropriate. Pushing that decision up to the runner couples the runner to every upstream's quirks.

3. **Retry parity is a property of the fan-out, not of any single client.** If two peers participate in the same `pLimit(N)` and one retries while the other doesn't, the retrying client masks load, the non-retrying client sheds it, and the runner's catch-all converts shed load into empty results that flow downstream as if they were valid.

## Prevention

1. **Audit rule for new external clients.** When adding any external client to
   a runner-style fan-out, grep for all siblings under the same `pLimit()` /
   `Promise.all()` / `Promise.allSettled()` and verify they share retry
   semantics. If asymmetric, normalize before merging. Concrete check for this
   repo: `rg -n "pLimit\\(|Promise\\.all" apps/mastra/src/services apps/admin/src/services`
   then for each hit verify every external client invoked in the same closure
   has retry.

2. **Test pattern.** Every external client gets a retry test suite that asserts
   retry on the documented set (429, 5xx, transport, timeout) and respects
   `Retry-After`. Current examples live in
   `apps/mastra/src/services/admin-search-eval-client.test.ts` and
   `apps/mastra/src/services/offline-search-eval/judge.test.ts`. Each retry
   test:
   - Mocks `fetch` to return a transient failure, then a 200.
   - Asserts `fetchImpl.toHaveBeenCalledTimes(2)` — proves retry happened.
   - For Retry-After: spies on `sleep` and asserts the wait matched the header (and was capped at 30s for large values).
   - For exhaustion: persistent failure across `maxAttempts` should produce the right typed error code (`rate_limited` vs `retry_exhausted` vs `timeout`).
   - For non-retryable: 400 must NOT retry (asserts `toHaveBeenCalledTimes(1)`).

3. **Code-review heuristic.** Any time a reviewer sees `pLimit(N)` followed by `.map(... → client.X())`, ask "does `X` retry?" for every distinct client. If the answer differs across clients in the same fan-out, block the PR.

4. **Shared helper when >=3 callers.** Don't extract on the first pair
   (premature abstraction); do extract when a third caller appears.

5. **Structured log convention.** Every retry attempt emits `event=<client>.retry attempt=N status=N wait_ms=N` so a future log-based alert can fire on "retry events exceed K/min across any client." Without the convention, each client invents its own log format and the alert can't be written.

6. **Rate-limit symmetry check before merge.** When adding a client whose upstream has a documented rate limit, compute `worst_case_fan_out = concurrency × items / window_seconds` and compare to the upstream cap. For PR #922 search-eval: `4 concurrent × 1500 items ÷ ~120s ≈ 50/sec ≈ 3000/min` vs admin's `30/min/IP` = 100× over. Either the client must retry, the runner must throttle, or the upstream must lift the limit. Document the chosen mitigation in the client's header comment.

## Related Learnings

- **`docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md`** — orthogonal: covers `Promise.allSettled` per-item best-effort aggregation. This learning covers retry-symmetry across the sibling clients invoked inside that allSettled.
- **`docs/solutions/runtime-errors/silent-semantic-search-degradation-missing-openrouter-key-20260415.md`** — the observability twin: same failure shape (swallowed external-client failure → silent degradation), different mitigation axis (probes + counters there; retry parity here). Both apply to any system that does graceful try/catch around an external call.
- **`docs/solutions/best-practices/bounded-parallelism-per-target-workflow-pattern-20260505.md`** — shared `pLimit` primitive. This learning is a failure mode of that pattern when sibling clients aren't retry-symmetric.
- **`docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`** — testing-discipline angle: mocked tests prove the retry branch shape exists; only a real-OpenRouter or real-admin smoke proves the retry survives the production contract (e.g., honoring Retry-After format variations).

## File References

- `apps/mastra/src/services/offline-search-eval/judge.ts` — OpenRouter judge
  retry behavior for offline eval.
- `apps/mastra/src/services/admin-search-eval-client.ts` — Admin HTTP retry
  behavior for catalog, candidate, trace, and no-trace search contracts.
- `apps/mastra/src/services/offline-search-eval/runner.ts` — fan-out site that
  consumes both retryable and non-retryable failures.
- `apps/mastra/src/services/admin-search-eval-client.test.ts` and
  `apps/mastra/src/services/offline-search-eval/judge.test.ts` — retry tests.
- PR: https://github.com/JesusFilm/forge/pull/922
