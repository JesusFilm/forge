---
title: Run mastra dev under a tsx loader when it externalizes raw-.ts workspace deps
date: 2026-06-24
category: tooling-decisions
module: apps/mastra
problem_type: tooling_decision
component: tooling
severity: high
applies_when:
  - "Wiring a Node-runtime-driven dev tool (mastra dev) that externalizes workspace deps and resolves them via Node's ESM loader"
  - 'A workspace package''s exports point at raw ./src/*.ts whose index re-exports siblings extensionlessly (export * from "./x")'
  - "mastra dev (or similar) crashes pre-boot with ERR_MODULE_NOT_FOUND on an extensionless workspace import while typecheck/test/build are all green"
symptoms:
  - "ERROR (Mastra CLI): Cannot find module '.../experience-ai.schemas' imported from '.../index.ts'"
  - "Crash fires in the parent mastra CLI (entry-analysis pass) before the dev-server child spawns"
  - "tsc, vitest, esbuild, and the production build/start path all pass — only mastra dev fails"
root_cause: config_error
resolution_type: config_change
related_components:
  - tooling
  - development_workflow
tags:
  - mastra
  - tsx
  - esm
  - node-resolver
  - extensionless-import
  - workspace-deps
  - dev-server
  - ts5097
---

# Run mastra dev under a tsx loader when it externalizes raw-.ts workspace deps

## Context

`MASTRA_STORAGE_BACKEND=memory pnpm --filter @forge/mastra dev` crashed **before boot**:

```
ERROR (Mastra CLI): Cannot find module
'/workspace/packages/experience-schema/src/experience-ai.schemas'
imported from /workspace/packages/experience-schema/src/index.ts
```

The repo convention is that every package under `packages/*` exports raw `.ts` source with no build step:

```jsonc
// packages/experience-schema/package.json
{ "type": "module", "exports": { ".": "./src/index.ts" } }
```

and `index.ts` re-exports its siblings **extensionlessly**:

```ts
// packages/experience-schema/src/index.ts
export * from "./experience-ai.schemas"
export * from "./extract-json-object"
export * from "./coerce-draft"
```

`mastra dev` **externalizes workspace deps** and lets Node's ESM loader resolve them at runtime, un-transpiled (the dev entry runs on Node 24 under `--experimental-transform-types`, which strips TS syntax but still uses Node's own ESM resolver). As of Node 24 under that flag, Node's ESM resolver does **not** guess file extensions, so `"./experience-ai.schemas"` resolves to nothing → `ERR_MODULE_NOT_FOUND`. (Extension-resolution and the type-stripping loader are both behind experimental flags that have shifted across Node majors — re-check the root cause if you reproduce on a different Node version or after the flags stabilize.)

Three things made it slippery:

- `typecheck` (tsc), `test` (vitest), and `build` (esbuild/Rollup) **all passed** — each toolchain silently fills in the `.ts` extension. Only the bare-Node runtime path failed.
- The throw originates in the **parent `mastra` CLI process** (entry-analysis pass), _before_ the dev-server child is spawned — confirmed by the `(Mastra CLI)` log label appearing before "Starting Mastra dev server". Any fix that only configures the child therefore cannot help. (session history)
- It surfaced only now because this was the **first multi-file raw-`.ts` workspace package the mastra runtime had loaded** — single-file packages never exercise extension resolution, so the convention had gone untested against bare Node. (session history)

## Guidance

When a Node-runtime-driven tool loads a workspace package whose `exports` point at **raw, un-transpiled `.ts`**, you must satisfy Node's actual ESM resolver — not just the build/test toolchain.

**Default fix — feed the runtime a TS-aware loader at the consumer, dev-only:**

```jsonc
// apps/mastra/package.json
"scripts": {
  "dev":   "NODE_OPTIONS=\"--import tsx\" mastra dev",   // ← tsx loader on parent CLI + child
  "build": "mastra build --studio",                      // unaffected: Rollup bundles the pkg
  "start": "MASTRA_STUDIO_PATH=.mastra/output/studio node .mastra/output/index.mjs"
},
"devDependencies": { "tsx": "^4.21.0", /* … */ }
```

`tsx`'s loader resolves extensionless `.ts` on **both** the CLI analysis pass and the spawned dev server, because `NODE_OPTIONS` propagates to the parent process and every child it spawns. `build`/`start` are untouched — the Rollup deployer bundles the workspace package, so production never hits the bare-Node resolver.

Two principles generalize beyond mastra:

1. **Honor the monorepo's raw-`.ts` convention by fixing it at the single consumer, not the shared package.** A loader flag on one app's `dev` script is strictly smaller blast radius than editing the shared package and rippling into every other consumer's tsconfig.
2. **Verify the fix on the process that actually throws.** Here the crash is in the _parent_ CLI, so the loader must reach the parent — `NODE_OPTIONS` does; a child-only flag does not.

Treat this as a **workaround for mastra dev's dev-vs-build asymmetry** (dev externalizes the raw `.ts` package; build bundles it), not a settled end-state. Revisit it if a future mastra release transpiles externalized workspace deps on the dev path the way it already does on build — at which point the loader flag becomes unnecessary.

What **NOT** to do (each re-verified):

1. **Don't add `.ts` extensions to the re-exports** (`export * from "./experience-ai.schemas.ts"`) + `allowImportingTsExtensions`. Throws **TS5097** in `@forge/experience-schema`, `@forge/mastra`, AND `@forge/admin` typechecks — every consumer compiles the package by realpath (all on `moduleResolution: "Bundler"`), so every consumer's tsconfig would need the flag.
2. **Don't use `mastra dev --custom-args "--import,tsx"`.** Per `mastra dev --help`, `--custom-args` is spliced into the dev-server child's `execArgv` only; the parent CLI still crashes. (This was the first attempt in-session — the parent-process error is exactly what forced the pivot to `NODE_OPTIONS`.) (session history)
3. **Don't switch to `.js` extensions** in the re-exports. Node's type-stripping loader does not remap `.js`→`.ts` against raw source.
4. **Don't add a dist build step / repoint `exports` to compiled output** for this one package. All `packages/*` uniformly export raw `./src/*.ts` with no build script; introducing one breaks the convention.
5. **Don't rely on `bundler: { transpilePackages: [...] }` on the `Mastra(...)` instance.** It is honored only on the Rollup build path, not on `dev` — verified by adding it and re-running dev, which still crashed. (session history)

## Why This Matters

This is a fresh instance of the repo's **"Mocked-vs-real testing discipline (META)"** law ([mocked-shape-vs-real-contract-discipline](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md)): mocked/tooling paths prove **SHAPE**; only the real runtime proves the production **CONTRACT**. Here the "tooling" is tsx/vitest/esbuild — all of which auto-resolve extensionless `.ts` and so paper over the gap — and the "real contract" is bare Node's ESM loader, which does not. Three green checks (`typecheck`, `test`, `build`) gave false confidence; the failure surfaced only when the actual Node runtime loaded the package. A CI matrix that never boots the dev entrypoint under bare Node keeps missing this class of bug.

Note the **direction of the tsx relationship** relative to the sibling doc [tsx-esm-named-export-resolution-across-workspace-package-boundary](../runtime-errors/tsx-esm-named-export-resolution-across-workspace-package-boundary-20260508.md): there, running **under tsx** is what _breaks_ (tsx's transformer fails to materialize named exports across an `exports`-map boundary → `SyntaxError: does not provide an export named …`), and the fix is to avoid the import. Here, the _absence_ of a TS loader (bare Node) is what breaks (missing-extension → `ERR_MODULE_NOT_FOUND`), and the fix is to _add_ tsx. Same raw-`.ts`-workspace-boundary territory, opposite mechanism and opposite remedy — so confirm which failure you have (missing **file/extension** vs missing **named export**) before reaching for either fix.

**When tsx does _not_ help.** [parity-harness-prod-gate-defects](../workflow-issues/parity-harness-prod-gate-defects-20260514.md) records `node --import tsx` (and `NODE_OPTIONS=--experimental-strip-types`) under "Tried and failed" — the opposite verdict to this doc. There is no contradiction, because tsx only ever fixes the **missing-extension** case (what we have here: `@forge/experience-schema` is `"type": "module"`, so the sole gap is the unguessed `.ts`). At least two _other_ failure modes across a raw-`.ts` workspace boundary produce a `does not provide an export named …` error that tsx does **not** fix:

- **Imported package is CommonJS** — it has no `"type": "module"`, so Node 24 classifies its `.ts` as CJS and the ESM importer can't see its named exports. A loader can't bridge a module-type mismatch. (parity-harness)
- **tsx's transformer doesn't materialize exports across the `exports`-map boundary** — even when the package source is correct and the export exists. ([tsx-esm-named-export](../runtime-errors/tsx-esm-named-export-resolution-across-workspace-package-boundary-20260508.md))

The imported package's nearest `package.json` `type` field distinguishes the first of those; it does **not** rule out the second. So treat the `type` field as a fast first check, not a complete discriminator. (Those two sibling docs describe the _same_ admin boundary: the **module-type/CommonJS** classification is the canonical root cause — confirmed against current code, since `apps/admin` is still CJS — and the 0508 doc's earlier _tsx-transformer_ framing has been corrected to cite it.)

## When to Apply

- Any time you wire a **new Node-runtime-driven dev tool** (a CLI that externalizes workspace deps and resolves them via Node's loader) against a monorepo whose packages export **raw `.ts`** rather than compiled `.js`.
- When a process **crashes at boot with `ERR_MODULE_NOT_FOUND` on an extensionless relative import** of a `./src/*.ts` sibling, while `typecheck`/`test`/`build` are all green.
- When deciding _where_ a resolver-mismatch fix belongs: prefer a **dev-only loader at the single consuming app** over edits that ripple into the shared package and every other consumer's tsconfig.
- As a pre-merge check: if a runtime path (not just build/test) loads a new package, run that runtime path. A green build is not a green boot.

## Examples

**The crash (raw `.ts` exports + extensionless re-export + bare-Node resolver):**

```
ERROR (Mastra CLI): Cannot find module '.../src/experience-ai.schemas'
imported from .../src/index.ts
```

**The fix (dev-only loader at the consumer):**

```diff
- "dev": "mastra dev"
+ "dev": "NODE_OPTIONS=\"--import tsx\" mastra dev"
```

```diff
  "devDependencies": {
+   "tsx": "^4.21.0",
    "typescript": "^5"
  }
```

**Rejected — `.ts` extensions (TS5097 across three packages):**

```ts
// packages/experience-schema/src/index.ts  ← DON'T
export * from "./experience-ai.schemas.ts"
// → TS5097 in @forge/experience-schema, @forge/mastra, AND @forge/admin
//   (each compiles the pkg by realpath; all on moduleResolution:"Bundler")
```

**Rejected — child-only arg (parent CLI still crashes):**

```bash
# DON'T — --custom-args reaches only the spawned dev-server child,
# but the throw is in the parent CLI's entry-analysis pass.
mastra dev --custom-args "--import,tsx"
```

The fix and its rationale also live in `apps/mastra/CLAUDE.md` under **"Why `dev` runs under `--import tsx`"** — that section is the in-package reference; this doc is the cross-cutting learning.

## Related

- [tsx-esm-named-export-resolution-across-workspace-package-boundary](../runtime-errors/tsx-esm-named-export-resolution-across-workspace-package-boundary-20260508.md) — sibling at the same raw-`.ts`-workspace-`exports` boundary, but the **opposite** mechanism: tsx itself fails to materialize a _named export_ (vs bare Node failing to resolve a _file extension_), and the remedy is to remove the import rather than add a loader. Candidate for a cross-link back; possible consolidation target.
- [mocked-shape-vs-real-contract-discipline](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md) — META home. Register this as another worked instance: tsx/vitest/esbuild (mock) auto-resolve the extensionless `.ts`; bare Node (real contract) does not.
- [parity-harness-prod-gate-defects](../workflow-issues/parity-harness-prod-gate-defects-20260514.md) — the inverse verdict on `--import tsx`: it failed there because the imported package was CommonJS (no `"type": "module"`), an ESM→CJS named-export seam a loader can't bridge. See "When tsx does _not_ help" above for the discriminator.
- [ts-source-package-js-extension-bundler-vs-nodenext](../build-errors/ts-source-package-js-extension-bundler-vs-nodenext-20260610.md) — adjacent: raw-`.ts` workspace exports diverging across bundler-vs-Node resolution; shares the "validate against every real consumer" prevention rule.
- `apps/mastra/CLAUDE.md` → "Why `dev` runs under `--import tsx`" — in-package reference for this exact decision.
