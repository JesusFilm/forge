---
title: "Killed Next.js dev server leaves a corrupt .next/dev/types/validator.ts that fails tsc --noEmit with TS1109 noise"
date: 2026-07-14
category: build-errors
module: any Next.js app (apps/chat, apps/web, apps/admin, apps/roadmap, apps/manager)
problem_type: build_error
component: tooling
symptoms:
  - "pnpm --filter <app> typecheck (tsc --noEmit) fails with a burst of TS1109 'Expression expected' (and similar syntax-error noise) pointing into .next/dev/types/validator.ts — a GENERATED file, not project source"
  - "The failure appears after a dev server for that app was killed (SIGKILL, terminal closed, agent-harness process cleanup) and persists across re-runs"
  - "App source is untouched and fine; only the generated file is syntactically broken"
root_cause: incomplete_setup
resolution_type: environment_setup
severity: low
tags: [nextjs, tsc, typecheck, dot-next, generated-types, dev-server, ts1109]
---

# Killed Next.js dev server leaves a corrupt .next/dev/types/validator.ts that fails tsc --noEmit with TS1109 noise

## Problem

A killed Next.js 16 dev server can leave a partially-written generated types
file — observed in this repo as `.next/dev/types/validator.ts` (per the
feat-241 session, where the chat app's typecheck failed this way after its dev
server was killed mid-run). Because every Next app's `tsconfig.json` in this
monorepo explicitly compiles the generated dirs, the broken file lands
directly in `tsc --noEmit`:

```jsonc
// apps/chat/tsconfig.json — the two `.next/**` lines are identical in
// web, admin, roadmap, manager (roadmap's source globs differ, the
// generated-dir includes do not)
"include": [
  "src/**/*.ts",
  "src/**/*.tsx",
  ".next/types/**/*.ts",
  ".next/dev/types/**/*.ts"
]
```

## Symptoms

- `tsc --noEmit` fails with TS1109 "Expression expected" (and related
  syntax-error noise) whose file path is under `.next/dev/types/` — not your
  source.
- Happens after the app's dev server was killed rather than shut down cleanly;
  the corrupt file persists until removed, so the failure survives re-runs.

## What Didn't Work

Reading the TS1109 errors as a source problem. The trap is an agent (or
developer) mid-task treating the typecheck failure as fallout from their own
edit and "fixing" unrelated code. The file path is the tell: anything under
`.next/` is generated output, and a syntax error there means a corrupt
artifact, never a source bug.

## Solution

Delete the app's `.next` directory and re-run:

```bash
rm -rf apps/<app>/.next
pnpm --filter @forge/<app> typecheck
```

The next `dev`/`build` regenerates the types. Nothing under `.next/` is
precious.

## Why This Works

The dev server writes generated type files (route validators among them)
incrementally; a kill mid-write leaves a truncated file. The tsconfig
`include` of `.next/dev/types/**/*.ts` is deliberate (it's how Next's
typed-routes validation reaches `tsc`), so the corrupt file is compiled like
source until it is removed. Removing `.next` clears all generated state at
once; the directory is fully reproducible.

## Prevention

- When a typecheck fails, check the reported file path FIRST: a path under
  `.next/` (or any generated dir) means clean the artifact, not the code.
- Prefer clean shutdown of dev servers when practical; after force-killing
  one, treat `rm -rf .next` as cheap insurance before running typecheck.

## Related Issues

- `docs/solutions/runtime-errors/nextjs-alloweddevorigins-hydration-dead-127-0-0-1-20260520.md`
  — a different member of the same family: Next dev-server-local behavior
  producing confusing failures unrelated to app source.
