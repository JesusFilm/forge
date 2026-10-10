---
title: useworkflow `"use workflow"` directives are inert in tests but enforced in production — test the dispatch, not just the body
date: 2026-04-21
category: best-practices
problem_type: best_practice
component: tooling
root_cause: inadequate_documentation
resolution_type: workflow_improvement
severity: medium
tags: [useworkflow, testing, admin, graphql, workflow-api]
---

## Problem

The `workflow` npm package (useworkflow) rewrites functions tagged with
the `"use workflow"` directive so they **must** be dispatched via
`start()` from `workflow/api`. Direct invocation throws at runtime in
production:

```
GraphQLError: You attempted to execute workflow runSceneEmbeddingBackfill
function directly. To start a workflow, use start(runSceneEmbeddingBackfill)
from workflow/api
```

**But the directive is inert outside the production Next.js build with
`withWorkflow` wired into `next.config.ts`.** `pnpm dev`, `vitest`, and
any other tooling that bypasses the build plugin execute the function
body as plain async — no runtime enforcement, no dispatch crash.

This divergence means **unit tests of the workflow body cannot catch
dispatch-site bugs.** A resolver or service that forgets to wrap its
call in `start()` passes every test and crashes on first live traffic.

Observed 2026-04-21 during R1 scene-embedding smoke in admin production
(feat-104). Five deploys of R1 shipped through CI (510 tests green) with
the bug live; it only surfaced when a real ADMIN principal invoked the
mutation against the built runtime.

## Symptoms

- Workflow-body unit tests pass.
- Production throws `"You attempted to execute workflow X directly"`
  on the first invocation.
- GraphQL Yoga (or the equivalent production server) masks the error as
  `"Unexpected error"` in the response; the real message is only in
  server logs.

## What Didn't Work

- **More workflow-body tests.** Adding cases for edge conditions,
  empty inputs, typed errors — all testing the function's _internals_.
  None of them exercise the dispatch boundary.
- **Relying on TypeScript.** `"use workflow"` is a string directive, not
  a type annotation. The TypeScript compiler sees a plain async
  function and accepts direct invocation everywhere.
- **Relying on `pnpm dev` as a pre-production check.** Dev mode also
  runs in inert-directive mode unless you specifically build + run
  against the compiled output. Most local development never hits the
  dispatch path.

## Solution

**Test the dispatch, not the body.** Every call site that invokes a
`"use workflow"` function needs a test that mocks `start()` from
`workflow/api` and asserts it was called with the workflow function
reference + the expected args tuple.

Admin ships a helper at `apps/admin/src/test-helpers/workflow-dispatch.ts`
that standardizes the pattern:

```ts
import { vi } from "vitest"
import { wrapStartSpy } from "@/test-helpers/workflow-dispatch"

const { start } = vi.hoisted(() => ({ start: vi.fn() }))
vi.mock("workflow/api", () => ({ start }))

import { runMyWorkflow } from "@/workflows/myWorkflow"
const dispatch = wrapStartSpy<MyReport>(start)

it("dispatches via start() with the right args tuple", async () => {
  dispatch.mockReturnValue(fakeReport)
  await callSiteUnderTest(input)
  dispatch.expectDispatched(runMyWorkflow, [input])
})

it("rejects unauthorized callers before any dispatch", async () => {
  await expect(callSiteUnderTest(input, unauthenticatedUser)).rejects.toThrow()
  dispatch.expectNotDispatched()
})
```

`vi.hoisted(() => ({ start: vi.fn() }))` is required because
`vi.mock` is hoisted above imports — the spy must exist at hoist time.

## Why This Works

The dispatch test fixes attention on the SDK boundary that only matters
in production. It catches:

- Missing `start()` wrapper (the whole reason this doc exists).
- Wrong workflow function reference (e.g., calling `start(someOtherFn)`).
- Wrong args shape — `start(fn, args)` takes an array; passing a bare
  object instead causes a silent type error that the body-test layer
  wouldn't notice.
- Dispatches that happen before an ABAC check rejects the caller.

It does NOT cover:

- Whether the workflow runtime itself is correctly wired (self-hosted
  `/.well-known/workflow/v1/*` routes). That needs a live smoke test
  against the compiled build.
- Whether the workflow body executes correctly once dispatched. That
  stays in the existing workflow-body tests.

## Prevention

### Standard checklist for new workflow features

Every PR that adds or modifies a `"use workflow"` function or its call
sites must include:

- [ ] **Workflow-body test** — existing pattern. Exercises the function
      internals with inert directives.
- [ ] **Dispatch test** — new pattern. Mocks `workflow/api`'s `start()`
      and asserts the call-site dispatches correctly.
- [ ] **Grep check** — before merge, run
      `grep -rn "from \"@/workflows\"" apps/admin/src | grep -v "\.test\."`
      to list every consumer. For each, verify it imports `start` from
      `workflow/api` and wraps the call.

### Why we don't try to catch this statically

We could add an ESLint rule that forbids calling `"use workflow"`
functions outside `start()`. Three reasons we haven't:

1. Identifying the tagged functions requires reading the source of the
   target module, which eslint rules don't do cleanly.
2. The tagged functions are also legitimately callable from within
   OTHER workflows (they compose). The rule would need to distinguish
   workflow contexts from non-workflow contexts.
3. The dispatch test is cheap and also catches ABAC-before-dispatch
   and args-shape regressions. One assertion, two wins.

### If smoke later reveals the test class missed something

Add a dispatch test case that would have caught it, then backfill the
helper if the new assertion is reusable.

## Related

- `docs/solutions/best-practices/verify-infra-writes-via-independent-read-path-20260420.md`
  — the meta-pattern that surfaced this bug. Live smoke against
  production caught what green CI missed.
- `docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md` —
  R1 primary learning doc; reference the dispatch fix from there.
- `apps/admin/src/test-helpers/workflow-dispatch.ts` — helper implementation.
- Fix PR: `docs/plans/2026-04-21-002-fix-admin-workflow-dispatch-plan.md`.

## Carry-forward

- **Manager's `"use workflow"` functions are still inert.** `apps/manager/next.config.ts`
  does NOT wrap `withWorkflow`. Manager's workflows run as plain async
  everywhere — tests and prod. When manager gets durable workflows,
  its call sites will need the same fix + dispatch tests.

- **Local-CLI usage of admin's workflow functions exploits the same
  inert-in-non-runtime property** (`apps/admin/src/scripts/run-embeds.ts`,
  shipped in plan 006 / PR #858). `runSceneEmbeddingBackfill` and
  `runTranscriptEmbeddingBackfill` are direct-invoked from the CLI
  with the in-process Prisma singleton — works because tsx-loaded
  scripts run outside the workflow runtime. The CLI's header comment
  flags this explicitly: deployed code paths must NOT direct-invoke
  these functions, only test/dev contexts may. See
  `docs/solutions/platform/local-embed-pipeline-pattern-20260429.md`.
