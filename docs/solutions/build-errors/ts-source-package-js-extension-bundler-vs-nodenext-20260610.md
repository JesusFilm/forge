# `.js` extensions in TS-source workspace packages break bundler consumers

**Date:** 2026-06-10
**Incident:** main CI red after #1187; fixed by #1190 (and on #1189's branch)
**Category:** build-errors

## What happened

`packages/admin-graphql` ships TypeScript SOURCE (`exports: { ".": "./src/index.ts" }`).
PR #1187 added a NodeNext consumer (`apps/yt-video-mapper-backend`,
`moduleResolution: NodeNext`), whose typecheck pulls the package's `.ts`
files into its own program and raises **TS2835** ("relative import paths
need explicit file extensions") on the package's extensionless internal
imports. The author "fixed" it by adding `.js` extensions to the package's
value-level relative imports (`export ... from "./admin.js"`).

That broke every BUNDLER consumer of the same TS source: web's Turbopack
build (`Module not found: Can't resolve './admin.js'`) and tv's Jest
(jest-expo/babel) — neither maps `./x.js` → `./x.ts` for workspace TS
source. Main CI went red on `build (@forge/web)` + `test (@forge/tv)` while
the PR's own target app stayed green.

## The rule

For a TS-source workspace package consumed under BOTH bundler resolution
(Next/Turbopack, Metro, Jest) and NodeNext resolution:

1. **Value-level relative imports inside the package must stay
   extensionless** (bundler-safe). NodeNext consumers only TS2835 on files
   that enter THEIR program — so keep the entrypoint module(s) a NodeNext
   consumer pulls free of extensionless value imports by **inlining the
   implementation into the entry file** rather than re-exporting through
   internal modules.
2. **Type-only imports may (and should) carry the `.js` extension** — they
   are erased at build time, so bundlers never resolve them, while the
   extension satisfies TS2835 for NodeNext consumers. This is the escape
   hatch for things like `import type { introspection } from "./admin-graphql-env.js"`.
3. Internal modules that only bundler consumers reach (e.g. the
   `fragments/` tree) can keep extensionless imports freely; document WHY
   with a guard comment so the next TS2835 "fix" doesn't reintroduce the
   breakage.

## Detection gap worth remembering

The breaking PR's own app passed all ITS checks; the damage surfaced only
in OTHER apps' matrix jobs on the same run. When CI on your PR shows
failures in apps you didn't touch, check whether main's tip is already red
(`gh run list --branch main`) before assuming your change caused it — and
if a shared `packages/*` file changed, the affected-matrix failures across
consumers ARE the signal, not noise.

For the sibling case where the breakage is **already green on main** (affected-gating
never re-checked it) and a **main-merge** surfaces it in an unrelated PR — diagnosed
with `git grep <symbol> origin/main` — see
`docs/solutions/workflow-issues/turborepo-affected-gate-hides-type-errors-between-prs.md`.
