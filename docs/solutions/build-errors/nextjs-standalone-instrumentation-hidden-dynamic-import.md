---
title: "Next.js standalone instrumentation can lose hidden runtime imports"
date: 2026-07-09
category: build-errors
module: apps/admin
problem_type: build_error
component: background_job
symptoms:
  - "Railway deployment failed during Admin worker startup after the image built"
  - "Healthcheck logs reported ERR_MODULE_NOT_FOUND for .next/server/chunks/instrumentation-workflow"
  - "The missing module was copied as source under .next/standalone/apps/admin/src but not emitted beside the compiled instrumentation chunk"
root_cause: missing_include
resolution_type: code_fix
severity: high
tags:
  - nextjs
  - turbopack
  - standalone
  - instrumentation
  - railway
  - workflow
---

# Next.js standalone instrumentation can lose hidden runtime imports

## Problem

The production `@forge/admin/worker` Railway deployment built its image, then
failed the startup healthcheck. The standalone server crashed while loading
Admin instrumentation because a runtime-only import pointed at a module that
Turbopack did not emit next to the compiled instrumentation chunk.

## Symptoms

- Railway marked the Admin worker deploy failed after image build.
- Runtime logs showed `ERR_MODULE_NOT_FOUND` for:

  ```text
  /app/apps/admin/.next/standalone/apps/admin/.next/server/chunks/instrumentation-workflow
  ```

- Local `pnpm --filter @forge/admin build` could pass, but the standalone
  runtime import still failed once Node executed the bundled instrumentation.

## What Didn't Work

- Hiding the import behind `new Function("specifier", "return import(specifier)")`
  avoided Edge-runtime bundling pressure, but it also hid the dependency from
  Turbopack's standalone trace. The source file was copied into standalone,
  but not emitted as a compiled sibling module at the path Node imported.
- Replacing the hidden import with a direct `await import("./instrumentation-workflow")`
  made the dependency visible, but the current Turbopack build panicked with an
  internal `there must be a path to a root` error. That made the visible split
  import too risky for a production hotfix.
- The Edge-runtime webpack replacement stub only helped webpack resolution; it
  did not make Turbopack emit the Node-side standalone module.

## Solution

Keep the workflow startup implementation in `apps/admin/src/instrumentation.ts`
itself instead of splitting it into a side module imported dynamically at
runtime. Gate execution with `process.env.NEXT_RUNTIME === "nodejs"` and the
existing workflow env flags, then perform the Node-only imports inside the
gated startup function:

```ts
export function shouldStartWorkflowWorld(): boolean {
  return (
    process.env.NEXT_RUNTIME === "nodejs" &&
    env.WORKFLOW_RUNNER_ENABLED === "true" &&
    env.WORKFLOW_TARGET_WORLD === "@workflow/world-postgres"
  )
}

async function startWorkflowWorld(): Promise<void> {
  const { getWorld } = await import("workflow/runtime")
  const { startWorkflowWorkerHeartbeat } =
    await import("@/services/workflow-worker-heartbeat.service")

  const world = getWorld()
  await world.start?.()
  await startWorkflowWorkerHeartbeat()
}
```

Remove the now-unused split files and the `NormalModuleReplacementPlugin` edge
stub from `apps/admin/next.config.ts`. After building, verify the standalone
output does not contain unresolved `instrumentation-workflow` references.

## Why This Works

Next instrumentation is a special entrypoint that Next compiles and loads from
the standalone server output. A relative dynamic import inside that compiled
chunk is resolved by Node relative to `.next/server/chunks`, not relative to
`src/`. If the import was hidden from Turbopack, standalone tracing can copy the
source file without producing the compiled module Node will request at runtime.

Inlining the startup code removes the fragile side-module boundary. The Node-only
libraries are still loaded lazily after the runtime/env gate, but there is no
extra relative instrumentation module for standalone output to misplace.

## Prevention

- Treat `apps/admin/src/instrumentation.ts` as the bundler boundary. Avoid
  hidden `new Function(... import ...)` indirection for relative imports from
  this file unless the standalone output is explicitly smoke-tested.
- For Admin worker deployment fixes, test the built standalone entrypoint, not
  only the TypeScript source and unit tests:

  ```bash
  pnpm --filter @forge/admin build
  rg "instrumentation-workflow" apps/admin/.next/standalone/apps/admin/.next/server
  ```

- Smoke both registration paths locally:

  ```bash
  WORKFLOW_RUNNER_ENABLED=false NEXT_RUNTIME=nodejs node - <<'NODE'
  const mod = require("./apps/admin/.next/standalone/apps/admin/.next/server/instrumentation.js")
  Promise.resolve(mod.register()).then(() => console.log("disabled-register-ok"))
  NODE

  (cd apps/admin && WORKFLOW_RUNNER_ENABLED=true WORKFLOW_TARGET_WORLD=@workflow/world-postgres NEXT_RUNTIME=nodejs node - <<'NODE'
  const mod = require("./.next/standalone/apps/admin/.next/server/instrumentation.js")
  Promise.resolve(mod.register()).then(() => console.log("enabled-register-ok"))
  NODE
  )
  ```

- If the enabled path reaches a local database refusal instead of
  `ERR_MODULE_NOT_FOUND`, the old standalone module-resolution failure is gone.
- Expect Edge-runtime warnings when Node-only instrumentation code sits in the
  instrumentation graph. They are not equivalent to a standalone runtime crash;
  rely on the standalone smoke to distinguish warning noise from deploy blockers.

## Related Issues

- [Railway + Next.js monorepo deployment: standalone mode pitfalls and runtime file access](../deployment/nextjs-pnpm-monorepo-railway-standalone.md)
- [Railway dashboard config silently shadows per-service railway.toml](../deployment/railway-dashboard-override-shadows-railway-toml-20260429.md)
- [Roadmap frontmatter type drift can crash Next.js static page-data collection](roadmap-frontmatter-normalization-next-build-crash.md)
