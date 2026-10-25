---
title: "Experience Embeddings Backfill: CJS Wrapper Pattern for Strapi v5 + tsx"
problem_type: best_practice
component: database
root_cause: missing_tooling
resolution_type: tooling_addition
severity: medium
date: "2026-04-14"
features:
  - "feat-096"
tags:
  - backfill
  - pgvector
  - embeddings
  - experiences
  - strapi
  - tsx-compat
  - cjs-wrapper
  - one-shot-script
  - idempotent
  - testing-pattern
  - module-resolution
module: cms
key_files:
  - "apps/cms/src/scripts/backfill-experience-embeddings.ts"
  - "apps/cms/src/scripts/backfill-experience-embeddings-cli.js"
  - "apps/cms/src/scripts/backfill-experience-embeddings.test.ts"
  - "apps/cms/src/api/experience/services/experience-embedder.ts"
related:
  - "docs/solutions/best-practices/experience-embedding-pipeline-pgvector-strapi-v5-20260414.md"
  - "docs/solutions/platform/backfill-worker-pattern-manager-20260407.md"
  - "docs/solutions/best-practices/pgvector-embedding-indexing-strapi-v5.md"
---

## Problem

After the experience embedding pipeline (feat-095) shipped, only newly published or updated experiences get embeddings via lifecycle hooks. All existing published experiences remained invisible to semantic search. A one-shot backfill script was needed to call `indexExperience()` for every published experience across all locales, but booting Strapi v5 programmatically from a standalone TypeScript script proved unexpectedly difficult due to ESM/CJS module resolution conflicts.

## Symptoms

- `ERR_UNSUPPORTED_DIR_IMPORT` for `lodash/fp` when running the script with `tsx`
- `TypeError: getGeneratorFunction is not a function` from `is-generator-function` when tsx module hooks were active during Strapi boot
- `SELECT count(*) FROM experience_embeddings` returns 0 for all existing content
- Search (feat-086) would launch with zero experiences indexed

## What Didn't Work

### 1. tsx as the script runner

```bash
# FAILS — lodash/fp directory import unsupported under ESM resolution
npx tsx src/scripts/backfill-experience-embeddings.ts --dry-run
```

tsx's ESM resolution hooks intercept all `require()` calls. Strapi's `@strapi/core` depends on `lodash/fp` (a directory import), which CJS handles natively but ESM does not.

### 2. Dynamic import() inside the TypeScript module

```typescript
// FAILS — import() always uses ESM resolution regardless of caller format
const { createStrapi } = await import("@strapi/strapi")
```

Even inside an async function in a CJS-transpiled module, `import()` uses ESM resolution semantics. The `lodash/fp` directory import still fails.

### 3. Registering tsx/cjs BEFORE loading Strapi

```javascript
// FAILS — tsx hooks interfere with make-generator-function
require("tsx/cjs")
const { createStrapi } = require("@strapi/strapi") // TypeError
```

tsx's module hooks intercept Strapi's transitive dependency on `is-generator-function` / `make-generator-function`, causing `getGeneratorFunction` to not be recognized as a function.

### 4. createRequire() inside the TypeScript module

```typescript
// FAILS — tsx was already registered at module load time
const { createRequire } = await import("node:module")
const req = createRequire(__filename)
const { createStrapi } = req("@strapi/strapi") // Same TypeError
```

By the time the TypeScript module executes, tsx is already registered (it loaded the module). The `createRequire` call creates a new require function, but tsx's hooks are already active globally.

## Solution

**Boot Strapi via plain CJS `require()` BEFORE registering tsx.** Split the script into two files:

### 1. CJS CLI wrapper (boots Strapi, then loads TS)

```javascript
// backfill-experience-embeddings-cli.js
const { createStrapi } = require("@strapi/strapi")

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes("--dry-run")
  const force = args.includes("--force")

  // Boot Strapi first (pure CJS, no tsx interference)
  const strapi = createStrapi({ distDir: "./dist" })
  await strapi.load()

  // NOW register tsx to load the TypeScript backfill module
  require("tsx/cjs")
  const { runBackfill } = require("./backfill-experience-embeddings.ts")

  try {
    const { failure } = await runBackfill(strapi, { dryRun, force })
    await strapi.db.connection.destroy().catch(() => {})
    process.exit(failure > 0 ? 1 : 0)
  } catch (err) {
    strapi.log.error(
      `[backfill-experience] Fatal: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    await strapi.db.connection.destroy().catch(() => {})
    process.exit(1)
  }
}

main()
```

### 2. Pure TypeScript logic module (testable)

```typescript
// backfill-experience-embeddings.ts
import type { Core } from "@strapi/strapi"
import { indexExperience } from "../api/experience/services/experience-embedder"

export async function runBackfill(
  strapi: Core.Strapi,
  options: { dryRun: boolean; force: boolean },
): Promise<{ success: number; failure: number }> {
  const knex = strapi.db.connection as any

  const result: { rows: ExperienceRow[] } = await knex.raw(`
    SELECT id, locale, slug
    FROM experiences
    WHERE published_at IS NOT NULL
    ORDER BY id, locale
  `)

  // Guardrails, dry-run, then for-loop calling indexExperience()
  // with per-item try/catch, progress logging, and failure counting
}
```

### 3. Package.json entry

```json
"backfill:experience-embeddings": "node src/scripts/backfill-experience-embeddings-cli.js"
```

Note: uses `node` (not `tsx`) as the runner — the CJS wrapper handles tsx registration itself.

### 4. Test architecture

Tests import `runBackfill` directly from the TypeScript module (vitest handles the transform). The Strapi instance is mocked — no need to boot real Strapi for unit tests. The CLI wrapper is tested via manual integration runs.

```typescript
vi.mock("../api/experience/services/experience-embedder", () => ({
  indexExperience: vi.fn(),
}))

const { strapi } = createMockStrapi(rows)
const result = await runBackfill(strapi, { dryRun: false, force: false })
```

## Why This Works

Strapi's dependency chain (`@strapi/core` → Koa → `is-generator-function` → `make-generator-function`, and `@strapi/core` → `lodash/fp`) relies on native Node.js CJS resolution, including directory-based imports. When tsx registers its module hooks, it overrides how all subsequent `require()` calls resolve modules, breaking these CJS-specific patterns.

By loading Strapi **before** tsx is registered:

1. All of Strapi's `require()` calls use vanilla Node.js CJS resolution
2. `lodash/fp` resolves as a directory (finds `index.js`) — works in CJS
3. `make-generator-function` loads correctly without tsx interference
4. Once Strapi is fully loaded and all its dependencies are cached, registering tsx only affects new module loads (the TypeScript backfill module)

The split architecture also solves testability: the TypeScript module has no side effects (no `main()`, no `process.exit`), accepts a Strapi instance as a parameter, and returns structured results — making it fully testable with mocked dependencies.

## Prevention

### 1. Always split Strapi CLI scripts into CJS wrapper + TS logic

```
script-name-cli.js     ← Plain CJS: boots Strapi, parses args, handles exit
script-name.ts         ← Pure logic: exported function(strapi, options) → result
script-name.test.ts    ← Tests: imports .ts directly, mocks Strapi
```

The CJS wrapper uses `node` as the runner (not `tsx`). It boots Strapi via `require()`, registers `tsx/cjs`, then loads the TypeScript module.

### 2. Boot framework first, register transpiler second

General rule for any framework with CJS dependencies that use non-standard resolution patterns (directory imports, conditional requires): load the framework before registering ESM shims or transpilers like tsx.

### 3. Never use `import()` for CJS framework bootstrap

`import()` always uses ESM resolution rules regardless of the calling module's format. Use `require()` in a CJS context for frameworks that depend on CJS resolution.

### 4. Guard `destroy()` with `.catch(() => {})` on all exit paths

If the DB connection is already broken (likely reason for being in a catch block), `destroy()` may throw. Wrap it to prevent double-fault masking the actual error.

### 5. Track total processed items for progress, not just successes

```typescript
const processed = success + failure
if (processed % PROGRESS_INTERVAL === 0) {
  strapi.log.info(
    `Progress: ${processed}/${total} (${success} ok, ${failure} failed)`,
  )
}
```

If progress only tracks successes, consecutive failures cause the progress display to stall, making the script appear hung.

### 6. Test with plain `node` first to isolate transpiler issues

Before debugging tsx/ESM issues, confirm the operation works with a minimal `node -e "require('@strapi/strapi')..."` one-liner. This isolates whether the problem is in your code or in the transpiler's module hooks.
