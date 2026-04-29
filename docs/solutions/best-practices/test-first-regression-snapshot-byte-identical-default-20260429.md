---
title: "Test-first regression snapshot for byte-identical-default invariants"
category: "best-practices"
problem_type: "best_practice"
component: "testing_framework"
root_cause: "missing_validation"
resolution_type: "test_fix"
severity: "medium"
module: "apps/cms"
tags:
  - testing
  - regression-test
  - opt-in-feature
  - test-first
  - vitest
  - snapshot
date: "2026-04-29"
related_prs:
  - "JesusFilm/forge#feat-109"
related_docs:
  - "docs/solutions/design-patterns/branched-orchestrator-opt-in-mode-pattern-20260429.md"
  - "docs/solutions/best-practices/prisma-raw-sql-invariant-assertions-20260423.md"
---

## Problem

When adding an opt-in feature behind a new argument (mode flag, feature
toggle, alternate pipeline), the hard constraint is usually
"byte-identical default behavior." That contract is easy to break
silently — a refactor 4 commits later might rearrange list-filtering or
list-pushing order, and existing tests for the _new_ code path won't
catch it. A regression snapshot test, **landed before any new-feature
code**, is the gate that holds across the whole PR.

## Symptoms

- The PR description says "default behavior is unchanged" but the only
  evidence is the absence of failures in pre-existing tests.
- A reviewer asks "what would actually break if Unit 3's branch
  silently changes the default path?" and there's no concrete answer.
- The branch passes CI through 5 commits and on the 6th the regression
  surfaces in production.

## What Didn't Work

- **Relying on existing tests.** Pre-existing tests cover scenarios
  they were originally written for, not the cross-cut "this argument
  set produces this exact response shape." Adding a new arg often
  means existing tests pass with `expect.objectContaining(...)` —
  silent shape drift.
- **End-of-PR snapshot.** Capturing the snapshot on the last commit
  defeats the purpose. By then any drift has already landed; the
  snapshot just records the new (potentially-broken) reality.
- **Manual diffing.** "Just curl the endpoint and compare with prod"
  doesn't scale and isn't repeatable.

## Solution

**Land the regression snapshot test as the FIRST commit of the
behavior-changing PR.** Capture it against the current `main` behavior
_before_ any new-argument plumbing or new-pipeline code. Every
subsequent commit must keep the snapshot green:

```ts
// First commit on the feature branch:
// apps/cms/src/api/search/services/search.regression.test.ts

const DEFAULT_MODE_CASES = [
  { label: "mode undefined", mode: undefined, expectsWarn: false },
  { label: "mode null", mode: null, expectsWarn: false },
  { label: "mode empty string", mode: "", expectsWarn: false },
  { label: 'mode "hybrid"', mode: "hybrid", expectsWarn: false },
  { label: 'mode "garbage"', mode: "garbage", expectsWarn: true },
]

it("produces byte-identical responses across all default-mode aliases", async () => {
  const baseline = await search(mockStrapi, { ...COMMON_PARAMS })

  for (const { label, mode } of DEFAULT_MODE_CASES) {
    vi.clearAllMocks()
    loadFixedFixture()
    const response = await search(mockStrapi, { ...COMMON_PARAMS, mode })
    // JSON.stringify catches key order, score precision, and field presence.
    expect(JSON.stringify(response), `case: ${label}`).toBe(
      JSON.stringify(baseline),
    )
  }
})
```

**Strengthen the snapshot with behavioral assertions** that go beyond
shape equality. The classic gap: a future refactor could dispatch the
new retrievers on the default path; if they return `[]` in the test,
the JSON-equality assertion still passes — but production fires the
extra DB queries. Add explicit `not.toHaveBeenCalled()` for each new
retriever:

```ts
it("default-mode aliases never invoke any keyword-first retriever", async () => {
  for (const { mode } of DEFAULT_MODE_CASES) {
    vi.clearAllMocks()
    await search(mockStrapi, { ...COMMON_PARAMS, mode })

    expect(searchByKeywordWeighted).not.toHaveBeenCalled()
    expect(searchByTrigram).not.toHaveBeenCalled()
    expect(searchByExactTitle).not.toHaveBeenCalled()
    expect(searchByKeyword).toHaveBeenCalled() // legacy IS called
  }
})
```

## Why This Works

- **Test-first sequencing.** When the snapshot lands first, any commit
  that breaks default behavior fails CI before merge. There's no
  "we'll add the test at the end" debt.
- **JSON-equality is the strongest single assertion.** Includes key
  order, score rounding, field presence, nullability. A response with
  `score: 0.95` reordered to `score: 0.94327` (different rounding)
  fails. Different `searchMode` value fails. Missing field fails.
- **Behavioral `not.toHaveBeenCalled()` plugs the holes JSON-equality
  misses.** Empty-array-returning mocks make different code paths look
  identical at the response level. The dispatch assertion catches
  _which_ code path actually ran.
- **Mocked retrievers are intentional.** This test validates the
  orchestrator's wiring (mode plumbing, list filtering, response
  mapping). Real-DB tests for end-to-end fusion behavior are a separate,
  follow-up concern; conflating them would slow the PR's CI feedback.

## Prevention

1. **Make this the first commit of any "byte-identical default" PR.**
   Treat the snapshot test as the gate, not as documentation.
2. **Run the test on `main` before capturing.** Verify the test would
   pass on a clone of `main` with the test file copied in. The captured
   snapshot must represent the pre-change baseline.
3. **Cover the unknown-value case.** Include `mode="garbage"` (or
   equivalent) in the case list. Warn-and-fallback semantics for
   unknown values are part of the "default behavior" contract.
4. **Pair JSON-equality with behavioral assertions.** Both pin shape
   AND dispatch. JSON-equality alone is insufficient when mocks return
   `[]`.
5. **Don't let the test become flakier than the system.** Use a
   deterministic seed, mock the inputs explicitly, and never rely on
   ordering that the implementation doesn't guarantee.

## Related

- `apps/cms/src/api/search/services/search.regression.test.ts` —
  feat-109's regression test. First commit on PR-B; held green
  through Units 3–5.
- `apps/cms/src/api/search/services/search.ts` — the orchestrator the
  test gates.
- `docs/solutions/best-practices/prisma-raw-sql-invariant-assertions-20260423.md`
  — analogous "lock in invariants at test-time" pattern for raw SQL.
