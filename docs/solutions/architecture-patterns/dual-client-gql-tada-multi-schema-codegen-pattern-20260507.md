---
title: "Dual-client gql.tada multi-schema codegen pattern (Pothos SDL → typed consumer)"
date: "2026-05-07"
category: "architecture-patterns"
module: "packages/graphql + apps/admin + apps/cms + apps/web + apps/mobile + apps/tv"
problem_type: "architecture_pattern"
component: "tooling"
severity: "high"
applies_when:
  - "A second backend (non-Strapi) emits its own GraphQL schema and consumers need compile-time type safety"
  - "You want result-type isolation between two schemas in the same gql.tada config"
  - "Admin/internal schema must disable introspection in prod but consumers still need typed SDL"
  - "You need a drift CI check to keep a committed SDL artifact in sync with Pothos source"
  - "Compile-time cross-schema assignment tests are written with @ts-expect-error directives"
tags:
  - "graphql"
  - "gql.tada"
  - "codegen"
  - "pothos"
  - "multi-schema"
  - "admin"
  - "cms"
  - "typescript"
  - "ci"
  - "turborepo"
  - "architecture"
related_components:
  - "apps/admin"
  - "apps/cms"
  - "packages/graphql"
  - "apps/web"
  - "apps/mobile"
  - "apps/tv"
  - ".github/workflows/ci.yml"
---

# Dual-client gql.tada multi-schema codegen pattern (Pothos SDL → typed consumer)

## Context

The Forge monorepo historically used a single GraphQL endpoint: Strapi CMS (`apps/cms`) exposing a schema that `packages/graphql` consumed via gql.tada, with `apps/web` and `apps/mobile` importing typed query documents from that shared package. When `apps/admin` was introduced as a Pothos-backed TypeScript GraphQL server, a gap emerged: admin had its own schema, its own resolvers, and its own set of client consumers (scripts, future UI surfaces) — but there was no typed bridge between admin and the consumer apps that would eventually migrate to it.

The naive options were all wrong:

- Duplicate gql.tada setup inside `apps/admin` itself (breaks the "one graphql package" convention; splits query ownership)
- Add admin queries directly to `packages/graphql` using the existing Strapi factory (wrong introspection — every admin-only field would be an unknown type error)
- Skip types entirely and call admin's GraphQL via raw `fetch` (defeats the entire point of the typed-client investment)

The solution was to extend `packages/graphql` into a **multi-schema hub**: a single package that initializes one gql.tada factory per schema, commits one SDL artifact per server, and wires drift detection in CI so authors cannot silently diverge the artifact from the live schema.

This was implemented and reviewed end-to-end in PR #902 (`feat/dual-client-codegen-unit-3`). The architectural brief that motivated the shape lives at `docs/brainstorms/2026-05-05-consumer-migration-implementer-brief-requirements.md`; the unit plan with detailed task breakdown lives at `docs/plans/2026-05-05-001-feat-dual-client-codegen-unit-3-plan.md`.

**Ownership note (auto memory [claude]):** the original brief assigned the SDL emit + drift CI work ("Unit 2") to the admin app's owner, treating it as security-boundary work that needed cross-team coordination. On 2026-05-07 a single-owner reorg consolidated both consumer-side and admin-side execution under one owner, and the unit was reclassified as pure infrastructure scaffolding. **The pattern itself does not depend on this ownership shape** — but the original mis-attribution is a useful tell: when in doubt, separate "infrastructure scaffolding around a schema" (low-risk, the consumer side can own) from "schema-changing work" (security-boundary, the schema author must own). The dual-client pattern is the former.

---

## Guidance

The pattern has six composable sub-decisions, plus one compile-time test. Each is independently meaningful; together they form the complete shape.

### 1. Multi-schema gql.tada config in `packages/graphql`

gql.tada's TypeScript plugin supports a `schemas` array in place of a single `schema` field. Each entry names a schema, points to its committed SDL artifact, and specifies where to emit its introspection types.

`packages/graphql/tsconfig.json`:

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "gql.tada/ts-plugin",
        "schemas": [
          {
            "name": "strapi",
            "schema": "../../apps/cms/schema.graphql",
            "tadaOutputLocation": "./src/graphql-env.d.ts"
          },
          {
            "name": "admin",
            "schema": "../../apps/admin/schema.graphql",
            "tadaOutputLocation": "./src/admin-graphql-env.d.ts"
          }
        ]
      }
    ]
  }
}
```

The `name` field is **load-bearing**, not cosmetic. gql.tada embeds a structural `name` discriminator into each generated introspection type (`name: 'strapi'` / `name: 'admin'`), and that discriminator is part of what makes cross-schema type assignments fail at compile time. Omitting `name` or reusing the same value for two schemas silently breaks type isolation.

Each `tadaOutputLocation` must be distinct. Pointing two schemas at the same output file overwrites the first.

### 2. Two factories, one package

Each schema gets its own factory function, initialized with its own introspection type. The factories live in separate modules under `packages/graphql/src/`.

`packages/graphql/src/admin.ts`:

```ts
import { initGraphQLTada } from "gql.tada"
import type { introspection } from "./admin-graphql-env"

export const adminGraphql = initGraphQLTada<{ introspection: introspection }>()

// readFragment is schema-agnostic; re-export so callers narrowing imports
// to "@forge/graphql/admin" still get the full fragment API.
export { readFragment } from "gql.tada"

export type {
  FragmentOf as AdminFragmentOf,
  ResultOf as AdminResultOf,
  VariablesOf as AdminVariablesOf,
} from "gql.tada"
```

`packages/graphql/src/graphql.ts` (the existing Strapi factory, unchanged in shape):

```ts
import { initGraphQLTada } from "gql.tada"
import type { introspection } from "./graphql-env"

export const graphql = initGraphQLTada<{ introspection: introspection }>()

export { readFragment } from "gql.tada"

export type { FragmentOf, ResultOf, VariablesOf } from "gql.tada"
```

`packages/graphql/src/index.ts` re-exports both side-by-side:

```ts
export { graphql, readFragment } from "./graphql"
export type { FragmentOf, ResultOf, VariablesOf } from "./graphql"

export { adminGraphql } from "./admin"
export type { AdminFragmentOf, AdminResultOf, AdminVariablesOf } from "./admin"
```

`packages/graphql/package.json` exposes a subpath for callers who want to narrow their import surface:

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./graphql": "./src/graphql.ts",
    "./admin": "./src/admin.ts"
  }
}
```

**Critical nuance on type isolation.** `AdminResultOf` is an aliased re-export of gql.tada's `ResultOf`. There is no nominal branding on the alias itself. Cross-schema assignment errors arise because each query document embeds the bound introspection's `name` discriminator, and `ResultOf<TDoc>` resolves field types by walking the document's selection set against that specific introspection — producing structurally distinct shapes when queries touch schema-exclusive fields. Selecting only fields that happen to exist in both schemas (e.g., a shared `id: ID!`) would produce structurally identical result types and silently defeat the isolation. See the type-isolation test below.

### 3. Committed SDL artifact via Pothos `printSchema`

The SDL file checked into the repo (`apps/admin/schema.graphql`) is the contract surface between the Pothos server and gql.tada. It is **not** generated at build time by Turbo; it is generated manually by the schema author and committed alongside the Pothos type changes that prompted it.

`apps/admin/src/scripts/print-schema.ts`:

```ts
#!/usr/bin/env tsx
import { writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  lexicographicSortSchema,
  parse,
  print,
  printSchema,
  visit,
} from "graphql"

import { schema } from "@/graphql/schema"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ADMIN_PKG_ROOT = resolve(SCRIPT_DIR, "../..")

const HEADER = `# This file is generated by apps/admin/src/scripts/print-schema.ts
# DO NOT EDIT — regenerate with: pnpm --filter @forge/admin schema:print

`

const POTHOS_DIRECTIVE_NAMES = new Set(["authScopes"])

function stripPothosDirectives(sdl: string): string {
  const document = parse(sdl)
  const cleaned = visit(document, {
    DirectiveDefinition(node) {
      return POTHOS_DIRECTIVE_NAMES.has(node.name.value) ? null : undefined
    },
    Directive(node) {
      return POTHOS_DIRECTIVE_NAMES.has(node.name.value) ? null : undefined
    },
  })
  return print(cleaned)
}

function main(): void {
  const sortedSchema = lexicographicSortSchema(schema)
  const rawSdl = printSchema(sortedSchema)
  const cleanedSdl = stripPothosDirectives(rawSdl)
  const outputPath = resolve(ADMIN_PKG_ROOT, "schema.graphql")

  // try/catch surfaces disk/permission errors with a named cause; CI's
  // git diff --exit-code would otherwise see a partial write as drift.
  try {
    writeFileSync(outputPath, HEADER + cleanedSdl + "\n", "utf8")
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    process.stderr.write(
      `[schema:print] failed to write ${outputPath}: ${reason}\n`,
    )
    process.exit(1)
  }

  process.stdout.write(
    `[schema:print] wrote ${cleanedSdl.length} chars to ${outputPath}\n`,
  )
}

main()
```

The `SCRIPT_DIR` / `ADMIN_PKG_ROOT` derivation anchors the output path to this script's location, not `process.cwd()`. `pnpm`/Turbo invocation sets cwd correctly, but raw `tsx` from the repo root would otherwise write `schema.graphql` to the wrong place and silently false-pass the drift CI check.

`apps/admin/package.json` wires the script:

```json
{
  "scripts": {
    "schema:print": "tsx src/scripts/print-schema.ts"
  }
}
```

**`lexicographicSortSchema` is load-bearing for determinism.** Without it, Pothos emits types in registration order. Adding a new resolver anywhere in the graph can reorder unrelated types in the SDL output, producing spurious diffs in `git diff` and false positives in the CI drift check. Alphabetic sort makes the artifact stable regardless of registration order.

**The script must be excluded from prettier** via `.prettierignore`:

```
packages/graphql/src/graphql-env.d.ts
packages/graphql/src/admin-graphql-env.d.ts
apps/cms/schema.graphql
apps/admin/schema.graphql
```

If prettier rewrites the committed SDL artifact, subsequent script runs will produce a non-prettier-formatted output and the drift CI job will fail every PR until you re-run prettier. Mirror whatever exclusions the existing committed-codegen artifact already has.

### 4. AST-based directive stripping (NOT regex)

Pothos plugins emit non-spec directives like `@authScopes` (from `@pothos/plugin-scope-auth`) that gql.tada's parser doesn't tolerate. A regex-based stripper has three concrete failure modes flagged by multiple reviewers during code review:

1. **Description corruption.** A regex like `/ @authScopes\([^)]*\)/g` strips matches inside field DESCRIPTIONS (GraphQL docstrings). A description like `"Use @authScopes(read:experiences) to gate this — see auth/permissions.ts"` loses the `@authScopes(read:experiences)` chunk silently. The committed SDL contains corrupted human-readable documentation.
2. **Multi-line directive declarations.** A directive declaration that wraps to two or three lines (`directive @authScopes(...) on FIELD_DEFINITION | OBJECT | INTERFACE | ARGUMENT_DEFINITION`) leaks partial lines through single-line regex patterns.
3. **Nested parens.** Directive arguments containing nested or escaped parens confuse the `[^)]*` heuristic.

The AST round-trip via `graphql-js` (`parse → visit → print`) is structurally aware. It removes nodes by `kind` and `name`, ignoring formatting, argument shape, or surrounding text. The `graphql-js` printer re-emits canonical SDL deterministically.

To add a new Pothos-internal directive to the strip list, append the name to `POTHOS_DIRECTIVE_NAMES`. No regex changes needed.

### 5. `inputs`-based Turbo wiring (NOT `dependsOn`)

Root `turbo.json`:

```json
{
  "tasks": {
    "generate": {
      "inputs": [
        "../../apps/cms/schema.graphql",
        "../../apps/admin/schema.graphql"
      ],
      "outputs": ["src/graphql-env.d.ts", "src/admin-graphql-env.d.ts"]
    },
    "schema:print": {
      "inputs": [
        "src/graphql/**/*.ts",
        "src/domain/**/*.ts",
        "src/scripts/print-schema.ts",
        "src/auth/permissions.ts"
      ],
      "outputs": ["schema.graphql"]
    }
  }
}
```

There is deliberately **no `dependsOn` edge from `generate` to `schema:print`**. The reason: `schema:print` requires booting the full Pothos schema build, which transitively imports services, env validation, and the Prisma client. Forcing that on every `pnpm turbo generate` would:

- Make local iteration slow for consumers who only changed a query document
- Pull service-layer dependencies into the codegen critical path
- Break in environments where Prisma or env vars aren't set up (e.g., CI codegen jobs that only have the schema artifact, not the full admin runtime)

The clean separation is: schema authors run `pnpm --filter=@forge/admin schema:print` manually when they change Pothos types. CI enforces the discipline via a drift check. Turbo's `inputs` hashing ensures `generate` re-runs if either SDL file changes, but `generate` itself never triggers `schema:print`.

### 6. Drift CI job

Two complementary checks in `.github/workflows/ci.yml`:

**Admin schema drift** (catches a schema author who forgot to commit the updated SDL):

```yaml
admin-schema-drift:
  runs-on: ubuntu-latest
  needs: affected
  if: >
    needs.affected.outputs.services != '[]' &&
    contains(fromJson(needs.affected.outputs.services), '@forge/admin')
  steps:
    - uses: actions/checkout@v6
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v6
      with:
        node-version-file: .nvmrc
        cache: pnpm
    - run: pnpm install --frozen-lockfile
    - name: Verify schema artifact is committed
      run: |
        pnpm turbo run schema:print --filter=@forge/admin
        git diff --exit-code apps/admin/schema.graphql
```

**Graphql generate drift** (extended to include the admin env file):

```yaml
- name: Verify codegen artifacts are committed
  run: |
    pnpm turbo run generate --filter=@forge/graphql
    git diff --exit-code \
      packages/graphql/src/graphql-env.d.ts \
      packages/graphql/src/admin-graphql-env.d.ts
```

Both checks fail with a non-zero exit if the committed artifact diverges from what the script would produce on the current source. The error from `git diff` is human-readable: it shows exactly which type definitions changed, making it actionable without re-running locally.

The CI job is gated on Turbo's `--affected` detection so it only fires on PRs that actually touch the relevant package, not every PR.

### 7. Compile-time type-isolation test (AE1)

A type-only test file asserts that cross-schema assignments fail at compile time. It has no runtime component — it's checked by `tsc --noEmit` and the IDE's language server, not by Vitest.

`packages/graphql/src/__tests__/dual-client.types.ts`:

```ts
import { graphql, type ResultOf } from "../graphql"
import { adminGraphql, type AdminResultOf } from "../admin"

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- only used via `typeof` for the type-isolation check.
const STRAPI_QUERY = graphql(`
  query StrapiBibleBook($documentId: ID!) {
    bibleBook(documentId: $documentId) {
      documentId
    }
  }
`)
type StrapiData = ResultOf<typeof STRAPI_QUERY>

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- only used via `typeof` for the type-isolation check.
const ADMIN_QUERY = adminGraphql(`
  query AdminExperienceBySlug($locale: String!, $slug: String!) {
    experienceBySlug(locale: $locale, slug: $slug) {
      id
      slug
    }
  }
`)
type AdminData = AdminResultOf<typeof ADMIN_QUERY>

declare const strapiValue: StrapiData
declare const adminValue: AdminData

// Positive cases: same-schema assignments must compile clean.
const _strapiToStrapi: StrapiData = strapiValue
const _adminToAdmin: AdminData = adminValue

// Negative cases: cross-schema assignments must fail.
// @ts-expect-error — Strapi's { bibleBook: ... } is not assignable to admin's { experienceBySlug: ... } shape.
const _strapiToAdmin: AdminData = strapiValue
// @ts-expect-error — admin's { experienceBySlug: ... } is not assignable to Strapi's { bibleBook: ... } shape.
const _adminToStrapi: StrapiData = adminValue

// The `_`-prefix on the const names suppresses some unused-binding linters.
// In repos where it doesn't (this monorepo's @typescript-eslint/no-unused-vars
// rule, for example), add `// eslint-disable-next-line @typescript-eslint/no-unused-vars`
// directly above each declaration. See Pitfall 2 below.
```

**Three pitfalls to avoid:**

**Pitfall 1 — accidental `@ts-expect-error` directives in comments.** TypeScript treats `// @ts-expect-error` anywhere in a single-line comment as a real directive. Writing prose like `// @ts-expect-error here — if a directive sneaks in, typecheck fails` accidentally suppresses the next line's type error. Use block comments `/* ... */` for any prose that mentions the pattern by name.

**Pitfall 2 — ESLint `no-unused-vars` on typeof-only bindings.** Query constants used only via `typeof` (never read at runtime) trip the `@typescript-eslint/no-unused-vars` rule even with an `_` prefix, because the rule checks for runtime usage, not type-level usage. Add `// eslint-disable-next-line @typescript-eslint/no-unused-vars` on the line before each declaration.

**Pitfall 3 — queries must select schema-exclusive fields.** If both test queries selected only fields that exist in both schemas (e.g., a shared `id: ID!`), the `ResultOf` shapes would be structurally identical and the cross-assignment would compile cleanly. The `@ts-expect-error` directives would then be flagged "unused" — a TypeScript error in the opposite direction. Always anchor each test query to at least one field that exists only in its own schema. In the example above, `bibleBook(documentId: ID!)` is a Strapi-only root query; `experienceBySlug(locale, slug)` is an admin-only root query.

**Mutation-test the test before declaring done (session history):** delete one of the `@ts-expect-error` directives temporarily and confirm typecheck fails with a real "Property X is missing" error. Then add a spurious `@ts-expect-error` to a positive case and confirm typecheck fails with "Unused '@ts-expect-error' directive". Both failure modes prove the test is meaningful — it gates real cross-schema errors, not a vacuous tautology.

---

## Why This Matters

**Single source of truth for types.** Before this pattern, a consumer of admin's GraphQL API had two paths: write untyped fetches or maintain a separate gql.tada config that duplicated the schema resolution logic. Both paths diverge independently from the actual schema over time. With the dual-client hub, there is exactly one place where schema-to-type mappings live, and CI enforces that it stays current.

**Schema-author ergonomics are preserved.** Pothos authors continue to work in TypeScript with full editor support. The SDL artifact is a mechanical output of `printSchema` — they never hand-edit it. The only discipline required is running `schema:print` when Pothos types change, which CI catches if forgotten.

**Consumer ergonomics are unchanged.** A component in `apps/web` importing from `packages/graphql` sees the same API it always did. An `apps/admin` script that wants typed admin queries imports from `packages/graphql/admin` and gets an identically ergonomic factory. No new tool, no new config file, no new import path convention beyond the subpath export.

**Type errors are caught at the call site, not at the network boundary.** Without typed queries, a renamed field in the Pothos schema would produce a runtime 400 or a silent `undefined` access. With the drift check keeping the SDL artifact current and gql.tada walking that artifact against every query document, the error is a compile-time red underline the moment the consumer's query references the old field name.

**Turbo caching is exact.** Because `generate`'s `inputs` are the two SDL files (not the entire `apps/admin/src/`), Turbo's cache key for codegen is stable when unrelated admin source files change. Codegen only re-runs when the schema surface actually changed.

**Production introspection can stay disabled.** Admin disables introspection in production (`@envelop/disable-introspection`) for security. The committed SDL is the artifact consumers read at codegen time; the production server never has to expose schema metadata to attackers.

---

## When to Apply

Apply this pattern when **all of the following** are true:

1. **Multiple GraphQL backends exist in the monorepo.** If there is only one backend, the standard single-factory gql.tada setup is simpler and sufficient.
2. **At least one backend is TypeScript-owned** (Pothos, graphql-js, Nexus, etc.) rather than schema-first. A schema-first backend typically already has an SDL as its source of truth; no `printSchema` step is needed, only the SDL pointer in the gql.tada config.
3. **Consumers are TypeScript apps that import from a shared package.** If each consumer app owns its own GraphQL config independently, the hub model adds overhead without benefit.
4. **You want compile-time enforcement of schema boundaries.** If cross-schema query confusion is not a real risk (e.g., one backend is internal-only and never exposed to the same consumers), the multi-schema config is unnecessary complexity.

Do **not** apply when:

- The "second backend" is a third-party API whose schema changes out of your control. The committed-SDL-artifact model breaks if you don't own the schema.
- The monorepo is already structured around per-app gql.tada configs with no shared package. Migrating to the hub model is a meaningful refactor, not a drop-in.
- Both backends share enough field names and types that schema-exclusive type isolation is impractical (e.g., two backends that both expose `User`, `Product`, `Order` with identical shapes). In this case the structural isolation is weak and the `@ts-expect-error` tests become fragile. Consider alternative isolation mechanisms (branded types, opaque marker classes) before committing to this pattern.

---

## Examples

### Adding a third schema (e.g., a future TV app's Pothos server)

The mechanical repetition for a third schema is what makes the pattern valuable. No architectural decision is needed once the shape is established.

**Step 1.** In `apps/tv`, create `src/scripts/print-schema.ts` following the same shape as admin's. Wire `schema:print` in `apps/tv/package.json`. Run it once to create `apps/tv/schema.graphql` and commit that file.

**Step 2.** Add the schema entry to `packages/graphql/tsconfig.json`:

```json
{
  "name": "tv",
  "schema": "../../apps/tv/schema.graphql",
  "tadaOutputLocation": "./src/tv-graphql-env.d.ts"
}
```

**Step 3.** Create the factory in `packages/graphql/src/tv.ts`:

```ts
import { initGraphQLTada } from "gql.tada"
import type { introspection } from "./tv-graphql-env"

export const tvGraphql = initGraphQLTada<{ introspection: introspection }>()

export { readFragment } from "gql.tada"

export type {
  FragmentOf as TvFragmentOf,
  ResultOf as TvResultOf,
  VariablesOf as TvVariablesOf,
} from "gql.tada"
```

**Step 4.** Re-export from `index.ts` and add the subpath export:

```ts
// index.ts additions
export { tvGraphql } from "./tv"
export type { TvFragmentOf, TvResultOf, TvVariablesOf } from "./tv"
```

```json
// package.json additions
{ "exports": { "./tv": "./src/tv.ts" } }
```

**Step 5.** Add `../../apps/tv/schema.graphql` to `generate`'s `inputs` in `turbo.json`. Add `src/tv-graphql-env.d.ts` to `outputs`.

**Step 6.** Add a `tv-schema-drift` job to CI. Copy the `admin-schema-drift` job, substitute `@forge/tv` and `apps/tv/schema.graphql`.

**Step 7.** Extend the `graphql-generate` drift check to include `packages/graphql/src/tv-graphql-env.d.ts`.

**Step 8.** Add to `.prettierignore`: `apps/tv/schema.graphql` and `packages/graphql/src/tv-graphql-env.d.ts`.

**Step 9.** Write the type-isolation test. In `packages/graphql/src/__tests__/dual-client.types.ts`, add a `TV_QUERY` binding using a tv-schema-exclusive field, and assert it doesn't cross-assign with the other `ResultOf` types. Mutation-test before commit.

### Using `adminGraphql` in a consumer script

Two correctness traps to avoid in this shape — both bite at the HTTP boundary, NOT at compile time:

```ts
import { print } from "graphql"
import { adminGraphql, type AdminResultOf } from "@forge/graphql/admin"

const FETCH_EXPERIENCE = adminGraphql(`
  query FetchExperience($locale: String!, $slug: String!) {
    experienceBySlug(locale: $locale, slug: $slug) {
      id
      slug
      blocks
    }
  }
`)

type FetchedExperience = AdminResultOf<typeof FETCH_EXPERIENCE>

type GraphQLResponse<T> = {
  data?: T
  errors?: ReadonlyArray<{ message: string }>
}

async function fetchExperience(
  locale: string,
  slug: string,
): Promise<FetchedExperience["experienceBySlug"]> {
  const url = process.env.ADMIN_GRAPHQL_URL
  if (!url) throw new Error("ADMIN_GRAPHQL_URL is not set")

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // `print()` from graphql-js serializes the typed document to a query
      // string. gql.tada documents have NO stable `toString()` — calling it
      // produces "[object Object]" or implementation-specific output and
      // produces a 400 from the server with no compile-time signal.
      query: print(FETCH_EXPERIENCE),
      variables: { locale, slug },
    }),
  })

  if (!res.ok) {
    throw new Error(`admin graphql HTTP ${res.status}: ${await res.text()}`)
  }

  const body = (await res.json()) as GraphQLResponse<FetchedExperience>
  if (body.errors?.length) {
    throw new Error(`admin graphql error: ${body.errors[0].message}`)
  }
  if (!body.data) {
    throw new Error("admin graphql returned no data")
  }
  return body.data.experienceBySlug
}
```

**Trap 1 — `FETCH_EXPERIENCE.toString()`** silently produces broken request bodies. gql.tada document objects do not have a stable SDL `toString()`. Always serialize via `print()` from `graphql`. (This trap is invisible at compile time; a typed factory does NOT cover transport-layer serialization.)

**Trap 2 — `process.env.X!` + untyped `res.json()`** flows `any` through the typed return, defeating the typed wrapper. Validate the env var at startup (or via a validated env module like `@/config/env` if available), and check `res.ok` + `body.errors` before reading `body.data`. The typed factory guarantees the SHAPE of `body.data` if present; it does not guarantee the response is well-formed.

The query document IS typed against the admin schema, so a renamed Pothos field surfaces as a compile error after `schema:print` + `generate` regenerate the introspection types — but only at the typed read sites, not at the transport boundary.

### Verifying the pattern is working locally

```bash
# 1. Print the admin schema artifact
pnpm --filter=@forge/admin schema:print

# 2. Regenerate gql.tada introspection types
pnpm --filter=@forge/graphql generate

# 3. Check that nothing diverges from what's committed
git diff apps/admin/schema.graphql packages/graphql/src/admin-graphql-env.d.ts

# 4. Type-check the isolation test (and the rest of the package)
pnpm --filter=@forge/graphql typecheck

# 5. Verify R4 (existing Strapi callsites unchanged) across consumers
pnpm --filter=@forge/web typecheck
pnpm --filter=@forge/mobile typecheck
# pnpm --filter=@forge/tv typecheck   # only if apps/tv exists (see "Adding a third schema" above)
```

If step 3 produces output, the SDL or introspection types are stale relative to the current Pothos source. Commit the diff before opening a PR, or CI's drift job will fail.

---

## Related

- **PR #902** (`feat/dual-client-codegen-unit-3`) — end-to-end implementation and multi-agent code review on this pattern.
- `docs/brainstorms/2026-05-05-consumer-migration-implementer-brief-requirements.md` — the architectural brief that motivated the dual-client shape, including the strategic rationale for keeping it temporary scaffolding (collapses back to single-target admin once Strapi is decommissioned).
- `docs/plans/2026-05-05-001-feat-dual-client-codegen-unit-3-plan.md` — the detailed unit plan including all five locked design decisions (factory naming, schema-source convention, scalar mapping policy, CI integration shape, Turbo wiring).
- `docs/roadmap/platform/feat-120-decouple-admin-sdl-emit-from-runtime-graph.md` — deferred follow-up: the `print-schema.ts` script currently triggers Prisma client construction + env validation at SDL emit time via the side-effect import chain through `@/graphql/schema`. Restructuring `apps/admin/src/graphql/builder.ts` to lazy-load services would decouple SDL emission from runtime concerns.
- `docs/solutions/integration-issues/expo-graphql-schema-drift-and-fragment-validation.md` — the specific drift incident this pattern's architecture prevents. That doc's Prevention §1 calls for "migrating to `@forge/graphql`" — the dual-client pattern documented here is exactly that migration.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — the type-isolation test (Pitfall 3 above) is a worked instance of this discipline applied to TypeScript types: prove the contract you think is load-bearing is actually tested as such, not a vacuous tautology.
- `docs/solutions/best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md` — analog for URL-template drift. Both that doc and this one prescribe "single authoritative source for the contract shape" with CI enforcement, applied to different contract surfaces (URL templates vs. GraphQL schema types).
