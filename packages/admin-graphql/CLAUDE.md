# packages/admin-graphql — Typed GraphQL Client (Admin)

## Purpose

This package provides a gql.tada typed GraphQL factory bound to admin's schema (`apps/admin/schema.graphql`). It is consumed by `apps/web` for all GraphQL operations against the admin GraphQL API.

`apps/web`, `apps/mobile`, and `apps/tv` read from admin via this package.

## Stack

- gql.tada for type-safe GraphQL operations
- TypeScript strict mode
- Codegen from admin's committed SDL artifact

## Surface

```ts
import { adminGraphql, readFragment } from "@forge/admin-graphql"
import type {
  AdminFragmentOf,
  AdminResultOf,
  AdminVariablesOf,
} from "@forge/admin-graphql"

const Q = adminGraphql(`
  query ExperienceBySlug($locale: String!, $slug: String!) {
    experienceBySlug(locale: $locale, slug: $slug) {
      id
      slug
    }
  }
`)
```

Fragments live under `@forge/admin-graphql/fragments`:

```ts
import { adminWatchExperienceFragment } from "@forge/admin-graphql/fragments"
```

That's the whole API: one factory, three type utilities, one `readFragment` helper, plus the fragment barrel.

## Generation flow

```
apps/admin/schema.graphql → packages/admin-graphql/src/admin-graphql-env.d.ts
```

Admin's `pnpm --filter @forge/admin schema:print` script emits `apps/admin/schema.graphql` from the Pothos types. Commit the regenerated SDL alongside Pothos changes.

Run `pnpm --filter @forge/admin-graphql generate` (which calls `gql-tada generate output`) to regenerate `admin-graphql-env.d.ts`. Commit the regenerated file — it's part of the contract.

CI verifies both artifacts independently: the `admin-schema-drift` job catches uncommitted Pothos→SDL drift; the `admin-graphql-generate` job catches uncommitted SDL→introspection drift.

## SDL-only consumption rule

This package consumes admin's committed SDL artifact (`apps/admin/schema.graphql`). It does NOT import from `apps/admin/src/domain/*`, `apps/admin/src/graphql/*`, or any other admin source.

Importing admin source from this package re-introduces the tsx-ESM named-export resolution trap documented in `docs/solutions/runtime-errors/tsx-esm-named-export-resolution-across-workspace-package-boundary-20260508.md`. The trap forced an ESM/CJS workaround in `apps/admin/src/domain/package.json` historically; the SDL-only rule eliminates that need.

If you find yourself reaching for an admin runtime type, lift the shape into the SDL (Pothos exposed type) or accept the duplication locally.

## Conventions

- Operations are defined in consuming apps (e.g., `apps/web/src/lib/...`) using the `adminGraphql()` factory exported here.
- Root WatchExperience composition + per-block fragments live in this package under `src/fragments/`. They're shared infrastructure across web routes. Per-page custom selections stay colocated in the consuming app.
- Run codegen after every admin SDL change.
- Commit generated type files — they are part of the contract.

## Common pitfalls

- **gql.tada cast drift across multiple queries selecting the same fragment.** Adding the same fragment as a second anchor to a different query can silently drift the cast type. See `docs/solutions/logic-errors/gql-tada-fragment-anchor-cast-drift-same-fragment-multi-query-20260514.md` for the failure mode and the typed-anchor pattern.
- **Cross-schema type contamination.** `AdminResultOf`/`AdminFragmentOf`/`AdminVariablesOf` are aliases for the same gql.tada utilities under the bare names — there is NO nominal branding. The naming is a call-site readability convention. Structural distinctness is enforced via `src/__tests__/type-isolation.types.ts`; an `as` cast bypasses it.
- **Forgetting to run codegen after a Pothos change** breaks types silently (builds pass, runtime fails). CI's `admin-graphql-generate` job catches this — don't merge red.
- **Never add `.js` extensions to value-level relative imports in this package.** This package ships TS source consumed under bundler resolution (web Turbopack, tv Jest, mobile Metro) — none of them map `./x.js` → `./x.ts`, so a `.js` extension breaks their builds/tests (main went red on 2026-06-10 this way). NodeNext consumers (yt-video-mapper-backend) are satisfied differently: the `"."` entry (`src/index.ts`) holds the implementation inline with only a **type-only** `.js`-suffixed import (erased at build time), and internal modules that NodeNext consumers never reach (`admin.ts` shim, `fragments/` tree) stay extensionless. See `docs/solutions/build-errors/ts-source-package-js-extension-bundler-vs-nodenext-20260610.md`.
