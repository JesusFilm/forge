# Workflow Authoring Pattern

Workflows use `useworkflow` (`workflow` npm package) with `"use workflow"`
and `"use step"` directives.

## File location

`src/workflows/<name>.ts` — constrained by `withWorkflow({ dirs: ['src/workflows'] })`
in `next.config.ts`. Placing workflow files outside this directory means
they won't be compiled by the workflow SDK build plugin.

## Structure

```ts
"use workflow"

export default async function myWorkflow(input: MyInput) {
  "use step"
  const step1Result = await doStep1(input)

  ;("use step")
  const step2Result = await doStep2(step1Result)

  return step2Result
}
```

## Step granularity

One step per **phase-page**, never per-record. A per-record step in Core
sync (thousands of videos) produces thousands of persisted step records.
Step input/output must be minimal: `{ processed, errors, nextOffset }`.

## Endpoint auth

Workflow callbacks arrive at `/api/workflows/[...workflow]/route.ts`
which validates HMAC-SHA256 signature + timestamp skew.

## Key rules

- Steps must be idempotent (may be retried)
- Never import heavy dependencies at the top level of a workflow file
  (it gets compiled by the build plugin)
- SYSTEM principal for workflow-initiated DB writes (not the triggering
  user's principal)
- The workflow runtime authenticates internally; the triggering user's
  identity is snapshotted into workflow input for audit only

## Reference

`src/workflows/` directory, `src/app/api/workflows/[...workflow]/route.ts`
