---
id: "feat-322"
title: "Update Mastra runtime dependencies"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-07-31"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "mastra"
  - "dependencies"
---

## Problem

The standalone Mastra runtime is pinned to a release set led by
`@mastra/core@1.36.0` and `mastra@1.10.0`, while the current compatible release
set is led by `@mastra/core@1.55.0` and `mastra@1.21.0`. Keeping the older set
misses runtime, storage, memory, observability, Studio, and CLI fixes. The newer
Editor also declares `@mastra/mcp` as a peer dependency, which the standalone
runtime does not currently declare directly.

## Entry Points - Read These First

1. `apps/mastra/package.json` - exact Mastra runtime dependency pins.
2. `apps/mastra/src/mastra/index.ts` - runtime construction across Core,
   Editor, storage, logging, and observability packages.
3. `apps/mastra/src/mastra/memory.ts` - Postgres-backed editor memory wiring.
4. `apps/mastra/src/mastra/ai-chat-memory.ts` - isolated Seeker memory wiring.
5. `pnpm-lock.yaml` - resolved Mastra package and peer graph.

## Grep These

- `@mastra/`
- `new Mastra(`
- `new MastraEditor(`
- `PostgresStore`
- `MastraStorageExporter`
- `createWorkflow`

## What To Build

1. Update the standalone runtime's direct Mastra dependencies to the current
   mutually compatible npm release set.
2. Add `@mastra/mcp` explicitly to satisfy the updated Editor peer contract.
3. Regenerate the pnpm lockfile without changing unrelated direct dependency
   pins.
4. Resolve any public API or type changes required by the new release set.
5. Prove the runtime still typechecks, tests, lints, and produces its deploy
   bundle with Studio assets.

## Constraints

- Keep the change scoped to `apps/mastra`; do not upgrade Admin's retired
  in-process playground stack in the same PR.
- Keep all direct Mastra package versions exact so the validated release set is
  reproducible.
- Do not weaken service-route authentication, storage isolation, observability
  redaction, or devotional workflow lifecycle guards while adapting APIs.
- Do not hand-edit pnpm package snapshots; regenerate them through pnpm.

## Verification

- `pnpm install --filter @forge/mastra...`
- `pnpm --filter @forge/mastra test`
- `pnpm --filter @forge/mastra typecheck`
- `pnpm --filter @forge/mastra lint`
- `pnpm --filter @forge/mastra build`
- `pnpm --filter @forge/mastra outdated`

## Completion Notes

- Updated the standalone runtime to `@mastra/core@1.55.0`,
  `mastra@1.21.0`, and the current compatible DuckDB, Editor, logger, memory,
  observability, and Postgres packages.
- Added `@mastra/mcp@1.15.0` explicitly to satisfy Editor's peer contract; the
  resolved standalone graph has no unmet Mastra peers.
- Adapted direct workflow-start tests to the newer Core input type, which
  expects Zod defaults to be resolved before `run.start` / `run.startAsync`.
- Made four existing search-eval path assertions platform-aware so the full
  Mastra suite validates on Windows as well as Linux.
- Verified 1,461 tests pass (3 credential-gated smoke tests skipped), plus
  typecheck, lint, and the production `mastra build --studio` bundle.
- The final outdated report lists only non-Mastra dependencies; every direct
  Mastra package in the standalone runtime is current as of 2026-07-31.
