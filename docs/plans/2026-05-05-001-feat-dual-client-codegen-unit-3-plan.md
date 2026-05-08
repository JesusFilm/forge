---
title: "feat: dual-client codegen for packages/graphql (Unit 3)"
type: feat
status: active
date: 2026-05-05
origin: docs/brainstorms/2026-05-05-consumer-migration-implementer-brief-requirements.md
---

# feat: dual-client codegen for packages/graphql (Unit 3)

## Summary

Implementation plan for Unit 3 of the consumer-side Strapi → admin migration: a typed `adminGraphql()` factory in `packages/graphql` co-existing with the existing Strapi `graphql()` factory. Lands as a standalone foundational PR with no consumer-side migration changes attached. Admin-side prerequisites (SDL emit script, CI drift check, initial committed schema artifact) sequence before this work — all owned by Urim per the 2026-05-07 ownership change documented in the origin brief.

---

## Glossary

This plan uses domain-specific terms. Skim this section first if any of them are unfamiliar.

### People & roles

| Term      | Meaning                                                                                                                                                                            |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Urim**  | Sole owner of this work as of 2026-05-07 — covers `apps/web`, `apps/mobile`, `apps/tv`, `packages/graphql`, and `apps/admin` (decisions and execution). Implements U2, U3, U4, U5. |
| **Nisal** | Owner of admin's data-plane work (embeddings, search, recommendations). Not directly involved in this plan, but his shipped work is the reason consumer migration is now possible. |

### Plan notation

| Term                            | Meaning                                                                                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **R-ID (R1, R2, …)**            | Requirement IDs. Each requirement is a "must-be-true" criterion this plan delivers; numbers trace back to the origin brainstorm doc.                                                                   |
| **U-ID (U1, U2, …)**            | Implementation Unit IDs. Each unit is a discrete chunk of work; numbers are stable across plan edits (never renumbered).                                                                               |
| **AE-ID (AE1, …)**              | Acceptance Example IDs. A concrete scenario that proves a requirement is satisfied (e.g., "given X, when Y, then Z").                                                                                  |
| **Origin doc / brainstorm doc** | The requirements document this plan was generated from: `docs/brainstorms/2026-05-05-consumer-migration-implementer-brief-requirements.md`.                                                            |
| **Unit 3**                      | The third unit in the broader 7-unit consumer migration. This plan covers Unit 3 specifically (other units are separate plans).                                                                        |
| **Consumer apps / consumers**   | `apps/web`, `apps/mobile`, `apps/tv` — the apps that read content from the CMS.                                                                                                                        |
| **Dual-client**                 | Having two GraphQL factories live side-by-side in `packages/graphql` during the migration: one bound to Strapi's schema, one to admin's. Temporary scaffolding; deleted when Strapi is decommissioned. |

### Tools & frameworks

| Term                       | Meaning                                                                                                                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GraphQL**                | Query language for APIs where the client describes exactly what data it wants. Strapi and admin both expose GraphQL endpoints.                                                                                        |
| **gql.tada**               | TypeScript-first GraphQL client used in `packages/graphql`. Lets you write queries as tagged template literals (e.g., `` graphql`query { ... }` ``) and infers their types at compile time without per-query codegen. |
| **Pothos**                 | TypeScript-first GraphQL schema-builder library admin uses to define its schema in code. The schema can be exported as SDL via `printSchema()`.                                                                       |
| **Strapi**                 | The headless CMS we're migrating away from. Currently the production content API for consumer apps; lives at `apps/cms/`.                                                                                             |
| **Apollo Client**          | The HTTP GraphQL client consumer apps use to actually issue queries to a GraphQL server. Handles auth headers, caching, etc. (Out of scope for this plan — that's Unit 5.)                                            |
| **Turborepo**              | The monorepo task runner used in this repo (`turbo.json`). Defines task dependency graphs (e.g., "build admin before generating types in packages/graphql").                                                          |
| **pnpm workspaces**        | How the monorepo links packages together. `"@forge/admin": "workspace:*"` means "depend on the sibling workspace package named @forge/admin".                                                                         |
| **TypeScript / typecheck** | Language with static types. "Run typecheck" means run the TS compiler in check-only mode (no output produced) to verify types are valid.                                                                              |

### GraphQL & type-safety concepts

| Term                                          | Meaning                                                                                                                                                                                                                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Schema**                                    | The shape of a GraphQL API: what types exist, what fields they have, what queries are available.                                                                                                                                                                        |
| **SDL (Schema Definition Language)**          | The text format for representing a GraphQL schema. Looks like `type Foo { id: ID! name: String }`. Strapi commits its SDL at `apps/cms/schema.graphql`.                                                                                                                 |
| **Introspection**                             | A live query that asks a running GraphQL server "what's your schema?". Admin disables this in production via `@envelop/disable-introspection` for security; that's why admin's schema needs to come from a committed SDL artifact instead of a live introspection call. |
| **Factory** (gql.tada term)                   | The `graphql()` or `adminGraphql()` function that turns query strings into typed objects. Bound to one specific schema's introspection; can't accept queries from another schema.                                                                                       |
| **Scalar**                                    | A "leaf" GraphQL type that has no fields of its own — like `String`, `Int`, `Boolean`, or custom ones like `DateTime` or `JSON`. Custom scalars need explicit TypeScript mappings configured in `tsconfig.json` so gql.tada knows what TS type to use.                  |
| **Tagged template literal**                   | JavaScript template strings with a function attached: `` graphql`query { foo }` ``. gql.tada parses these at compile time to derive types.                                                                                                                              |
| **`@ts-expect-error`**                        | A TypeScript directive that asserts "the next line should produce a type error; if it doesn't, the build fails". Used in U5 to verify that mixing Strapi-typed and admin-typed values is actually a compile error.                                                      |
| **`as` cast**                                 | A TypeScript escape hatch (`value as SomeType`) that force-converts one type to another, bypassing the normal type check. Acknowledged out-of-scope gap in U5 — `as` casts can defeat AE1's type-isolation guarantee.                                                   |
| **Structural typing**                         | TypeScript's rule that two types are assignable if their shapes match, even if their names differ. Why U5's negative tests must use schema-exclusive fields — otherwise two structurally-identical types would compile cross-assignment.                                |
| **PUBLIC tier**                               | Admin's authorization scope for unauthenticated requests. Currently exposes 4 queries: `experienceBySlug`, `searchExperiences`, `hybridSearch`, `sceneRecommendations`. Anything else requires authentication.                                                          |
| **Anonymous HTTPS**                           | An HTTP request with no `Authorization` header. The auth posture this plan documents for consumer-app admin reads.                                                                                                                                                      |
| **`printSchema` / `lexicographicSortSchema`** | Functions from `graphql-js` that serialize a runtime schema object to SDL text. `lexicographicSortSchema` sorts types and fields alphabetically so the output is deterministic across runs.                                                                             |

### Project-specific files referenced

| Path                                          | What it is                                                                                                                                                                                                                                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/cms/`                                   | The Strapi (existing) CMS app.                                                                                                                                                                                                                                                                     |
| `apps/admin/`                                 | The new admin CMS app (admin-app). Replacing Strapi long-term.                                                                                                                                                                                                                                     |
| `apps/admin/schema.graphql`                   | (To be created in U2.) Admin's SDL artifact, committed to the repo. The "do not edit" file.                                                                                                                                                                                                        |
| `apps/admin/src/graphql/schema.ts`            | Admin's Pothos schema entry point — assembles types into the runtime schema object.                                                                                                                                                                                                                |
| `apps/admin/src/scripts/print-schema.ts`      | (To be created in U2.) The script that emits admin's SDL via `printSchema(...)`.                                                                                                                                                                                                                   |
| `apps/cms/schema.graphql`                     | Strapi's existing committed SDL artifact (4109 lines, auto-emitted by Strapi's GraphQL plugin). The pattern admin mirrors.                                                                                                                                                                         |
| `packages/graphql/`                           | The shared typed-GraphQL workspace package. Currently single-target Strapi; this plan adds admin as a second target.                                                                                                                                                                               |
| `packages/graphql/src/graphql.ts`             | The current Strapi factory module.                                                                                                                                                                                                                                                                 |
| `packages/graphql/src/admin.ts`               | (To be created in U4.) The new admin factory module.                                                                                                                                                                                                                                               |
| `packages/graphql/src/graphql-env.d.ts`       | The generated Strapi introspection types. Committed.                                                                                                                                                                                                                                               |
| `packages/graphql/src/admin-graphql-env.d.ts` | (To be created in U3 via codegen.) The generated admin introspection types. Will be committed.                                                                                                                                                                                                     |
| `packages/graphql/tsconfig.json`              | TypeScript config including the gql.tada plugin entry. U3 modifies this to add the second schema target.                                                                                                                                                                                           |
| `turbo.json` (root)                           | Workspace-root Turborepo task graph. The `generate` task in this file gets `apps/admin/schema.graphql` added to its `inputs` (matching how Strapi's SDL is already declared); a separate `schema:print` task is also defined here. **No `dependsOn` edge** — see Open Questions for the rationale. |

---

## Problem Frame

`packages/graphql` is currently single-target gql.tada bound to Strapi's schema only. The consumer-side migration (origin: `docs/brainstorms/2026-05-05-consumer-migration-implementer-brief-requirements.md`) requires both Strapi-typed and admin-typed GraphQL queries to coexist in the consumer apps for the duration of the migration window. Without dual-client wiring, no `apps/web` / `apps/mobile` / `apps/tv` migration unit can issue type-safe admin queries, and parity-comparator work (Unit 4) has nothing to compare against on the admin side.

---

## Requirements

- R1. `packages/graphql` exports a second typed GraphQL factory bound to admin's schema, sitting alongside the existing Strapi factory. Both factories are independently typed; mixing produces a TypeScript error. (origin R1) — owned by Urim, delivered in U3-U5.
- R2. Admin's schema is sourced as a static SDL artifact committed to the repo, regenerated by an admin-side script emitting SDL via Pothos `printSchema`. (origin R2) — owned by Urim, delivered in U2; gates U3.
- R3. CI verifies the live Pothos schema matches the committed SDL artifact (required by R2) and fails the build on drift. The check lands as a new `admin-schema-drift` job in `.github/workflows/ci.yml`, mirroring the existing `graphql-generate` job (lines 78–95) and gated on `@forge/admin` affected via Turbo. (origin R2a) — owned by Urim, delivered in U2 alongside R2; gates U3 only after R2 lands.
- R4. The first dual-client landing is a small, standalone PR with no consumer-side migration changes attached. Existing Strapi callsites in web, mobile, TV, and manager continue to type-check and run unchanged. (origin R3) — owned by Urim, enforced across U3-U5.
- R5. AE1 is enforced at compile time: assigning a Strapi-typed result to an admin-typed variable (or vice versa) fails TypeScript compilation. (origin AE1) — owned by Urim, delivered in U5.

**Origin actors:** A1 (Urim — sole owner of consumer-side and admin-side work as of 2026-05-07)
**Origin acceptance examples:** AE1 (covers R1, R5)

---

## Scope Boundaries

- All other migration units are out: Unit 1 inventory, Unit 2 admin PUBLIC schema widenings, Unit 4 parity harness, Unit 5 web canary + block adapter, Unit 6 mobile/TV migration, Unit 7 runbook
- Apollo client wiring in `apps/web/src/lib/client.ts` is out — that is Unit 5 territory
- Block JSON-to-typed-blocks adapter is out — Unit 5 territory
- Any consumer code changes (`apps/web`, `apps/mobile`, `apps/tv`) are out
- Strapi decommission and the eventual `packages/graphql` collapse back to single-target admin are out — separate cleanup ticket
- Resolution of brainstorm Outstanding Questions that do not affect Unit 3 (canary route selection, observability thresholds, mobile/TV cache strategy, EAS/TestFlight cadence anchors)

### Deferred to Follow-Up Work

- Unit 1 inventory document: separate plan/PR
- Unit 2 admin PUBLIC schema widenings: separate plan/PR (still Urim's queue, but tracked separately to keep this Unit 3 plan focused)
- Unit 4 parity harness: separate plan/PR
- Unit 5 web canary slice + block adapter: separate plan/PR

---

## Context & Research

### Relevant Code and Patterns

- `packages/graphql/tsconfig.json` — current single-schema gql.tada plugin config (extended to multi-schema in U3)
- `packages/graphql/src/graphql.ts` — current Strapi factory (`initGraphQLTada<{ introspection }>()` pattern)
- `packages/graphql/src/index.ts` — current exports (`graphql`, `readFragment`, `FragmentOf`, `ResultOf`, `VariablesOf`)
- `packages/graphql/src/graphql-env.d.ts` — generated Strapi introspection (committed)
- `packages/graphql/package.json` — current `@forge/cms: workspace:*` workspace dep + `generate` script
- `apps/cms/schema.graphql` — example committed SDL artifact (4109 lines, "generated by Nexus Schema, do not edit" header)
- `apps/admin/src/graphql/schema.ts` — Pothos schema entry point (`builder.toSchema()`)
- `apps/admin/src/graphql/plugins/introspection.ts` — production introspection-disable plugin (env-gated)
- `apps/admin/src/scripts/` — existing tsx-based admin scripts pattern (`run-core-sync.ts`, `run-embeds.ts`, etc.)
- `apps/admin/package.json` — existing admin script wiring pattern

### Institutional Learnings

- `docs/solutions/platform/devcontainer-setup.md` — pnpm via corepack; respects `packageManager` field in root `package.json`
- `apps/cms/schema.graphql` is committed and regenerated by Strapi's lifecycle, not by hand; admin should follow the same convention via deterministic `printSchema`
- Admin disables introspection in production via `@envelop/disable-introspection` (`apps/admin/src/graphql/plugins/introspection.ts`); SDL must be sourced from a build-time emit, not live introspection

### External References

- gql.tada multi-schema configuration: `tsconfig.json` plugin entry uses a `schemas: [...]` array (each entry has `name`, `schema`, `tadaOutputLocation`). The `name` is set in the tsconfig entry and emitted by codegen into each generated introspection's `.d.ts` file; factories import their respective introspection types and call `initGraphQLTada<{ introspection: ... }>()` with the existing single-arg shape (no new parameter on the factory call)
- Pothos `printSchema(lexicographicSortSchema(builder.toSchema()))` produces deterministic SDL output suitable for committing. `lexicographicSortSchema` handles type/field ordering; directive emission (e.g., `@authScopes`) depends on which Pothos plugins admin uses and may need explicit handling in U2

---

## Key Technical Decisions

- **Multi-schema gql.tada configuration shape**: tsconfig plugin entry switches from single `schema` to `schemas: [...]` array with two entries (Strapi + admin), each entry carrying its own `name`, `schema` path, and `tadaOutputLocation`. Each factory imports its own generated introspection type from a separate `.d.ts` file; the `name` field lives inside the generated introspection type (set by gql.tada's codegen from `schemas[i].name`), and `initGraphQLTada<{ introspection: typeof <introspection> }>()` keeps its existing single-arg shape — nothing new is passed to the factory call. Type isolation flows from `Schema['name']` being structurally distinct between the two introspections. Rationale: this is the documented gql.tada multi-schema pattern. Alternative considered (separate `@forge/admin-graphql` workspace package) rejected because it adds workspace plumbing for no gain — the two factories share scalar-mapping infrastructure and codegen scripts.

- **Schema sourced as committed SDL via Pothos `printSchema`**: admin emits its schema deterministically via `printSchema(lexicographicSortSchema(builder.toSchema()))`, writes to `apps/admin/schema.graphql`, and commits the artifact. Rationale: matches existing Strapi pattern (`apps/cms/schema.graphql` is committed; consumers do not need cms running for codegen). Live introspection rejected because admin disables introspection in production. (origin Key Decision)

- **CI drift check via `admin-schema-drift` job in `forge-ci` (R3)**: a new job in `.github/workflows/ci.yml` runs `pnpm turbo run schema:print --filter=@forge/admin` then `git diff --exit-code apps/admin/schema.graphql`. Mirrors the existing `graphql-generate` job (lines 78–95) which does the same for `packages/graphql/src/graphql-env.d.ts`. Gated on `@forge/admin` affected via Turbo's `--affected` detection so it only fires on PRs touching admin. Rationale: catches the case where an admin Pothos change is merged without regenerating the SDL artifact, which would silently make consumer codegen wrong. There is no separate admin CI workflow file — the check lives in the shared `forge-ci` workflow alongside every other CI job.

- **AGENTS.md updates land with the factory PR (U4), not as a separate unit**: dual-client conventions documented in `packages/graphql/AGENTS.md` and `packages/graphql/CLAUDE.md` in the same PR that introduces the factory. Rationale: keeps the PR's reviewer surface coherent (code + how-to-use + auth-posture convention) and prevents the conventions from drifting before they are written down.

- **Type-isolation test uses compile-time assertions, not runtime tests**: a TypeScript file using `// @ts-expect-error` directives verifies that mixing Strapi-typed and admin-typed results fails at compile. Rationale: AE1 is fundamentally a TypeScript-level guarantee; runtime tests would not exercise the type system. Compile-time assertions are the canonical pattern for type-utility tests.

---

## Open Questions

### Resolved During Planning

- **Schema artifact path**: `apps/admin/schema.graphql` (mirrors Strapi's `apps/cms/schema.graphql`)
- **Generated env file path**: `packages/graphql/src/admin-graphql-env.d.ts` (mirrors `graphql-env.d.ts`)
- **Factory module path**: `packages/graphql/src/admin.ts`
- **Workspace dependency**: `packages/graphql/package.json` adds `@forge/admin: workspace:*` (mirrors `@forge/cms` pattern). Note: this declaration alone does not enforce build ordering. Resolved via Turbo `inputs` rather than `dependsOn` — matches the existing Strapi pattern. The `generate` task in `turbo.json` adds `apps/admin/schema.graphql` to its `inputs` list (alongside `apps/cms/schema.graphql`); Turbo invalidates the cached `.d.ts` outputs when the SDL files change but does NOT auto-run `schema:print`. The schema author runs `schema:print` manually after editing admin's Pothos types; CI's `admin-schema-drift` job catches the case where they forget. See U3 Files for the `turbo.json` edit. (`dependsOn` was rejected because it would re-run admin's full Pothos schema build on every local `generate` run even when admin hasn't changed — slow and divergent from how Strapi works in the same package.)
- **SDL emit script location**: `apps/admin/src/scripts/print-schema.ts`. Locked here, not "or top-level scripts/". Every existing admin tsx-script lives at `src/scripts/` so admin's `@/` path-alias resolution works; a top-level `scripts/` directory would be outside the path-alias root and would not import `@/graphql/schema`
- **U1 handoff doc** — REMOVED 2026-05-07: U1 (design sync) was deleted when tatai handed full ownership over. No handoff doc is created.
- **Auth posture (origin R3)**: The admin factory is documentation-and-convention only — it produces typed GraphQL document objects, not HTTP requests. Auth posture for the actual HTTP transport is enforced in consumer-app Apollo clients (Unit 5). AGENTS.md notes that admin queries are intended to be issued via clients configured for anonymous HTTPS by default. **Acknowledged gap:** between U3 merge and Unit 5's Apollo client wiring, no compile-time guard prevents a contributor from writing a non-PUBLIC admin query — the only protection is convention plus PR review. Documented gap, not a defect

### Deferred to Implementation

- **Scalar mappings — RESOLVED 2026-05-07**: ship U3 with no scalar overrides on either factory; gql.tada defaults apply. Strapi's six read-side custom scalars (`Date`, `DateTime`, `I18NLocaleCode`, `JSON`, `Long`, `Time`) and admin's single custom scalar (`JSON`) all default to `unknown`. The codebase has shipped this way for over a year on Strapi without observed friction; symmetric `unknown` treatment for admin is the least-surprising default. Reversible: if a scalar bites in the canary route (Unit 5), add the mapping then and document in AGENTS.md.
- ~~**CI integration mechanism for R3 drift check**~~ — RESOLVED via U1 sync defaults: new `admin-schema-drift` job in `.github/workflows/ci.yml` mirroring the existing `graphql-generate` job structure, gated on `@forge/admin` affected via Turbo
- ~~**`turbo.json` edit shape for `@forge/graphql#generate` dependency**~~ — RESOLVED via U1 sync defaults: `inputs`-based (not `dependsOn`), matching existing Strapi pattern. New separate `schema:print` task defined alongside admin's other tasks in root `turbo.json`
- **AGENTS.md update scope**: minimum-viable update covers (a) which factory to use when, (b) auth-posture convention including the acknowledged gap above, (c) reference to the multi-schema generation flow, (d) the U5 type-isolation test path as the AE1 verification mechanism, (e) live introspection rationale (admin disables it via `@envelop/disable-introspection`, so SDL artifact is the only viable source). Larger doc rewrites deferred to follow-up
- **Test scenario placement**: standalone `packages/graphql/src/__tests__/dual-client.types.ts` or inline at `packages/graphql/src/admin.test.ts`. Choose at implementation time based on existing test conventions in the package

---

## Implementation Units

- U1. **REMOVED 2026-05-07** — design sync with tatai is gone. Tatai handed full ownership over; the five technical decisions the sync would have locked are recorded directly in this plan: factory naming (Key Technical Decisions), schema-source convention (Open Questions → Resolved), scalar mappings (Open Questions → Resolved), CI integration shape (Key Technical Decisions, R3), and Turborepo task-graph wiring (Open Questions → Resolved, U3 Files). U-IDs are stable and not renumbered; U2/U3/U4/U5 keep their numbers.

---

- U2. **Admin-side prerequisites (Urim-owned, blocks U3-U5)**

**Goal:** Admin emits deterministic SDL via `printSchema`; admin CI verifies drift; initial committed `apps/admin/schema.graphql` artifact lands.

**Requirements:** R2, R3

**Dependencies:** none (U1 removed; technical decisions are recorded directly in this plan)

**Files:**

- Create: `apps/admin/src/scripts/print-schema.ts`
- Modify: `apps/admin/package.json` (add `schema:print` script wiring: `"schema:print": "tsx src/scripts/print-schema.ts"`)
- Create: `apps/admin/schema.graphql` (initial committed SDL artifact)
- Modify: `.github/workflows/ci.yml` (add `admin-schema-drift` job mirroring the existing `graphql-generate` job, gated on `@forge/admin` affected via Turbo)
- Modify: root `turbo.json` (define a new `schema:print` task with `outputs: ["schema.graphql"]`. There is no `apps/admin/turbo.json`; admin's task definitions live in the workspace-root `turbo.json` alongside admin's other tasks)

**Approach:**

- Admin-side script imports Pothos `builder`, runs `printSchema(lexicographicSortSchema(builder.toSchema()))`, writes deterministic SDL to `apps/admin/schema.graphql`. The script must explicitly **prepend a "do not edit" header banner** to the output (Strapi/Nexus auto-emits this; Pothos does not — must be added in the script body)
- Inspect the emitted SDL for Pothos plugin directives (e.g., `@authScopes` from scope-auth) before committing. If directives appear and gql.tada cannot tolerate them in U3 codegen, strip them post-print and document the strip rule in the script
- Drift check job (added to `.github/workflows/ci.yml`): `pnpm turbo run schema:print --filter=@forge/admin` then `git diff --exit-code apps/admin/schema.graphql`. Job structure mirrors the existing `graphql-generate` job (lines 78–95), including `needs: affected` and the `if: contains(fromJson(needs.affected.outputs.services), '@forge/admin')` gate so the job only fires on PRs touching admin

**Execution note:** Owned by Urim end-to-end. Lands as its own PR (or paired with U3 if review hygiene allows) before consumer-side U3 wiring begins.

**Patterns to follow:**

- `apps/cms/schema.graphql` — example committed SDL with the "do not edit" header (Strapi/Nexus auto-emits this; for admin the print-schema script must add it explicitly)
- `apps/admin/src/scripts/run-core-sync.ts` — existing tsx-script pattern. The print-schema script lives at the same path level (`apps/admin/src/scripts/`) so admin's `@/` path-alias resolves correctly when the script imports from `@/graphql/schema`

**Test scenarios:**

- Happy path: running the script against the current Pothos schema produces a non-empty SDL file with all expected types
- Edge case: running the script twice in a row produces byte-identical output (deterministic)
- Integration: CI drift check fails when a schema-affecting change in `apps/admin/src/graphql/` is merged without regenerating the artifact
- Integration: CI drift check passes when the regenerated artifact is committed alongside the schema change

**Verification:**

- `apps/admin/schema.graphql` exists, is committed, and contains the live Pothos schema as SDL
- `pnpm --filter @forge/admin schema:print` produces byte-identical output on repeated runs
- A test case in admin CI demonstrates drift detection by intentionally desyncing the artifact and watching CI fail

---

- U3. **`packages/graphql` multi-schema tsconfig + codegen wiring**

**Goal:** `packages/graphql` is configured for two introspection targets (Strapi + admin); `pnpm --filter @forge/graphql generate` emits both `graphql-env.d.ts` and `admin-graphql-env.d.ts`.

**Requirements:** R1, R4

**Dependencies:** U2 (admin schema artifact must exist on disk and be merged to `main` before U3 PR opens — see Risks for cross-PR ordering). With single ownership, U2 and U3 can also land in a single PR if review hygiene allows.

**Files:**

- Modify: `packages/graphql/tsconfig.json` (gql.tada plugin: single `schema` → `schemas: [...]` array)
- Modify: `packages/graphql/package.json` (add `@forge/admin: workspace:*` dep, add `generate:admin` script or extend `generate`)
- Modify: root `turbo.json` (extend the existing `generate` task — add `apps/admin/schema.graphql` to `inputs` and `src/admin-graphql-env.d.ts` to `outputs`, mirroring how the existing entry handles Strapi. There is no `packages/graphql/turbo.json`; all task definitions live in the workspace-root file. **No `dependsOn` edge is added** — see Open Questions for the rationale)
- Generated: `packages/graphql/src/admin-graphql-env.d.ts` (committed)

**Approach:**

- tsconfig plugin entry shape: `schemas: [{ name: "strapi", schema: "../../apps/cms/schema.graphql", tadaOutputLocation: "./src/graphql-env.d.ts" }, { name: "admin", schema: "../../apps/admin/schema.graphql", tadaOutputLocation: "./src/admin-graphql-env.d.ts" }]`
- Scalar mappings: ship with no `scalars` field on either factory (per the resolved Open Question 2026-05-07). gql.tada defaults apply: Strapi's six read-side custom scalars (`Date`, `DateTime`, `I18NLocaleCode`, `JSON`, `Long`, `Time`) and admin's single custom scalar (`JSON`) all default to `unknown`. The codebase has shipped this way for over a year on Strapi; symmetric `unknown` for admin is the least-surprising default. Do NOT introduce admin scalar mappings without addressing Strapi's at the same time. The plan's prior premise that "Strapi-side mappings already exist" is incorrect — verified empty in current `tsconfig.json` and `graphql.ts`. Reversible: if a scalar bites in the canary route (Unit 5), add the mapping then and document in AGENTS.md.
- `generate` script (or new `generate:admin` script): runs `gql-tada generate output` for the admin target. Verify the existing `generate` continues to produce the Strapi `.d.ts` unchanged
- Existing Strapi callsites in `apps/web`, `apps/mobile`, `apps/tv`, `apps/manager` continue to type-check unchanged (R4)
- **Cross-PR ordering:** U3 must be opened against a base branch where `apps/admin/schema.graphql` already exists (i.e., U2 merged to `main` first). If the merge ordering inverts, `packages/graphql` typecheck fails for ALL existing Strapi callsites until U2 lands. See Risks

**Patterns to follow:**

- `packages/graphql/tsconfig.json` — current single-schema plugin entry shape
- gql.tada multi-schema documented pattern (referenced in External References)

**Test scenarios:**

- Happy path: `pnpm --filter @forge/graphql generate` produces both `.d.ts` files; both are non-empty and structurally valid
- Edge case: running generate against a clean checkout produces byte-identical output to the committed `.d.ts` files (idempotent within one environment)
- Edge case (cross-environment): the same `generate` command on a Linux CI runner with the same Node major version produces output byte-identical to a developer's macOS run. If divergence is observed (CRLF, plugin-version drift, Node-version drift), pin gql.tada's exact version (no caret) and document the platform/Node assumption in `packages/graphql/CLAUDE.md`
- Integration: `pnpm --filter @forge/graphql typecheck` passes with both schemas present
- Integration: typecheck of consumer packages (`apps/web`, `apps/mobile`, `apps/tv`, `apps/manager`) passes after U3 lands — required to verify R4 ("Existing Strapi callsites continue to type-check unchanged"). The U3 PR's CI must run typecheck against ALL consuming packages, not just `packages/graphql` itself
- Regression: existing Strapi-typed test files in `packages/graphql/src/` still typecheck

**Verification:**

- `packages/graphql/src/admin-graphql-env.d.ts` exists, is committed, and contains admin's introspection types
- Running `generate` is idempotent (second run produces no diff)
- `pnpm --filter @forge/graphql typecheck` passes
- A spot-check `apps/web/src/lib/content.ts` continues to type-check unchanged (no Strapi-side regression)

---

- U4. **`adminGraphql` factory + index re-exports + AGENTS.md update**

**Goal:** A typed `adminGraphql()` factory is exported from `@forge/graphql` alongside the existing `graphql()`. AGENTS.md and CLAUDE.md document the dual-client conventions and auth-posture expectations.

**Requirements:** R1, R4, R5

**Dependencies:** U3 (admin introspection types must exist)

**Files:**

- Create: `packages/graphql/src/admin.ts`
- Modify: `packages/graphql/src/index.ts` (re-export `adminGraphql`, `AdminResultOf`, `AdminFragmentOf`, `AdminVariablesOf`)
- Modify: `packages/graphql/AGENTS.md`
- Modify: `packages/graphql/CLAUDE.md`

**Approach:**

- `admin.ts` exports `adminGraphql = initGraphQLTada<{ introspection: <admin-introspection> }>()` plus typed utilities (`AdminResultOf<T>`, `AdminFragmentOf<T>`, `AdminVariablesOf<T>`) — same shape as existing `graphql.ts`
- `index.ts` re-exports both factories side by side; type utilities are namespaced (`ResultOf` for Strapi, `AdminResultOf` for admin) to make mixing visually obvious
- AGENTS.md update covers: (a) which factory to use (Strapi for legacy paths until consumer migration moves them; admin for new admin-targeted queries), (b) auth-posture convention (admin queries are intended to be issued via Apollo clients configured for anonymous HTTPS by default; non-PUBLIC admin queries are out of scope until Unit 2 widens auth scopes), (c) reference to the multi-schema generation flow
- CLAUDE.md gets the same update for compatibility-context

**Patterns to follow:**

- `packages/graphql/src/graphql.ts` — single-line factory pattern
- `packages/graphql/AGENTS.md` — existing tone and structure

**Test scenarios:**

- Happy path: importing `adminGraphql` from `@forge/graphql` returns a function that accepts a tagged-template GraphQL string
- Happy path: typing a query against the admin factory produces an `AdminResultOf` shape derived from admin's SDL (e.g., `experienceBySlug` returns its admin-side projection)
- Edge case: calling the factory with an empty template-literal still produces a typed (empty) document object without runtime crash
- Integration: importing both factories in the same file does not cross-pollute their introspection types (covered structurally in U5)

**Verification:**

- `import { adminGraphql, AdminResultOf } from "@forge/graphql"` resolves and is typed
- `import { graphql, ResultOf } from "@forge/graphql"` continues to work unchanged
- AGENTS.md update reads coherently for a contributor approaching the package fresh; the auth-posture and which-factory rules are visible without scrolling
- `pnpm --filter @forge/graphql typecheck` passes

---

- U5. **Type-isolation test enforcing AE1 at compile time**

**Goal:** AE1 is enforced at compile time. Mixing a Strapi-typed result with an admin-typed variable (or vice versa) produces a TypeScript error.

**Requirements:** R1, R5

**Dependencies:** U4 (factory must be importable)

**Files:**

- Create: `packages/graphql/src/__tests__/dual-client.types.ts` (or equivalent path matching package conventions)

**Approach:**

- A single TypeScript file with `// @ts-expect-error` directives covering the cross-assignment cases:
  1. Strapi `ResultOf<typeof STRAPI_QUERY>` assigned to an `AdminResultOf<typeof ADMIN_QUERY>` typed variable (negative — must error)
  2. Vice versa: admin result assigned to Strapi-typed variable (negative — must error)
  3. Same-type assignments (positive — must NOT have `@ts-expect-error`; compile clean)
- **Critical: the queries used in the negative cases MUST reference fields exclusive to one schema** (e.g., a Strapi-only field name vs an admin-only field name). If both queries select fields that happen to exist on both schemas with structurally-identical types, TypeScript's structural typing will treat them as assignable, the `@ts-expect-error` directives become unused, and typecheck fails for the wrong reason. A future contributor "fixing" the unused directive then deletes the test's actual guard. Pick query pairs where at least one selected field exists on only one side. An inline comment in the test file warns future contributors against using structurally-overlapping queries
- **Acknowledged out-of-scope gap:** `as` casts deliberately bypass type isolation (e.g., `result as any as AdminResultOf<...>`). U5 does NOT cover this. AGENTS.md notes that as-casting between Strapi and admin types defeats AE1 by design; reviewers should reject on sight. An ESLint rule against this specific shape is a follow-up, not part of Unit 3
- File runs as part of `pnpm --filter @forge/graphql typecheck`; no runtime execution needed

**Execution note:** Test-first execution posture for U5 specifically — write the type assertions with `@ts-expect-error` markers first; if a positive case (same-type) accidentally has `@ts-expect-error`, typecheck fails because the directive is unused; if a negative case is missing `@ts-expect-error`, typecheck fails because the cross-type assignment is reported as a normal type error. Both failure modes prove the test is meaningful

**Patterns to follow:**

- gql.tada-published examples of type-level testing
- Any existing TypeScript-only test files in the workspace

**Test scenarios:**

- Covers AE1. Happy path: assigning a Strapi result to a Strapi-typed variable compiles; assigning an admin result to an admin-typed variable compiles
- Covers AE1. Error path: assigning a Strapi result to an admin-typed variable produces a TypeScript error caught by `@ts-expect-error`
- Covers AE1. Error path: assigning an admin result to a Strapi-typed variable produces a TypeScript error caught by `@ts-expect-error`
- Edge case: removing one of the `@ts-expect-error` directives on a negative-case assignment causes typecheck to fail (proves the directive is gating a real error, not accidentally passing)
- Edge case: adding an `@ts-expect-error` directive to a same-type (positive) assignment causes typecheck to fail (proves the positive case is genuinely error-free)

**Verification:**

- `pnpm --filter @forge/graphql typecheck` passes with the test file in place
- Manual deletion of any `@ts-expect-error` on a negative-case assignment causes typecheck to fail (proves the assertions are real)
- The file is documented inline as the AE1 enforcement mechanism; AGENTS.md (U4) references its path

---

## System-Wide Impact

- **Interaction graph:** `packages/graphql` is consumed by `apps/web`, `apps/mobile`, `apps/tv`, `apps/manager`. After this PR, all four continue to use the existing `graphql()` factory unchanged. The `adminGraphql()` factory is available for future use but has zero callsites in this PR.
- **Error propagation:** No runtime error paths affected — this is a build-time / type-level change.
- **State lifecycle risks:** None — no persistent state, no migration semantics.
- **API surface parity:** The `@forge/graphql` package adds new public exports (`adminGraphql`, `AdminResultOf`, etc.) without removing or renaming existing exports.
- **Integration coverage:** U3 verification spot-checks an `apps/web` callsite to confirm Strapi-side regression-free. U4 verification covers both factory imports working in the same file. U5 covers the type-isolation guarantee.
- **Unchanged invariants:** All existing Strapi-typed callsites in `apps/web`, `apps/mobile`, `apps/tv`, `apps/manager` continue to type-check and run unchanged. `packages/graphql/src/graphql.ts` and `packages/graphql/src/graphql-env.d.ts` are not modified by this PR.

---

## Risks & Dependencies

| Risk                                                                                                                                                                                                                                       | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~Tatai unavailable for U1 sync~~                                                                                                                                                                                                          | RESOLVED 2026-05-07 — U1 removed.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Pothos `printSchema` produces non-deterministic output (e.g., directive ordering, scalar plugin ordering)                                                                                                                                  | U2 explicitly tests for deterministic output (script run twice produces byte-identical SDL). If non-deterministic, wrap with `lexicographicSortSchema` (already in plan) or strip plugin directives post-print. U2 also inspects emitted SDL for Pothos directives like `@authScopes` and resolves whether to keep or strip them.                                                                                                                                                       |
| **U2 and U3 land in inverted order**: U3 references `apps/admin/schema.graphql` in tsconfig; if U3 merges before U2, `packages/graphql` typecheck breaks for ALL existing Strapi callsites in web/mobile/tv/manager (R4 silently violated) | With single ownership, mitigation simplifies: either ship U2 + U3 in one PR (recommended for the foundational landing), or open U3 against a base where U2 is already on `main`. The cross-owner merge-ordering coordination is no longer the risk — Urim controls both PRs.                                                                                                                                                                                                            |
| **gql.tada `generate` non-deterministic across environments** (Node major version, OS line endings, plugin version)                                                                                                                        | U3 verification includes a cross-environment determinism check (developer macOS vs Linux CI same Node major). If divergence appears, pin gql.tada's exact version (no caret) and document the assumption in `packages/graphql/CLAUDE.md`. Standard hygiene: regenerate-and-commit on every consuming PR if drift is observed.                                                                                                                                                           |
| Admin-side scalar emits a custom scalar that gql.tada cannot map cleanly                                                                                                                                                                   | Scalar approach is RESOLVED (see Open Questions): ship U3 with no overrides on either factory; gql.tada defaults apply. Admin's only custom scalar is `JSON`, which Strapi also exposes — both default to `unknown` and the codebase has handled `unknown`-typed scalars fine for over a year. If a problematic scalar surfaces during U3 implementation or in the canary route (Unit 5), fall back to an explicit mapping in `tsconfig.json` and document the limitation in AGENTS.md. |
| `@forge/admin: workspace:*` dependency does not enforce build ordering on its own                                                                                                                                                          | Resolved via Turbo `inputs`, not `dependsOn`. The `generate` task adds `apps/admin/schema.graphql` to its `inputs` so Turbo invalidates the cached `.d.ts` when admin's SDL changes. The schema author runs `schema:print` manually after editing admin's Pothos types (documented in `packages/graphql/AGENTS.md`); CI's `admin-schema-drift` job catches the case where they forget. Matches existing Strapi pattern.                                                                 |
| AE1 type-isolation accidentally allows cross-schema queries to compile due to structurally-identical inferred types                                                                                                                        | U5 uses negative test cases against schema-exclusive fields (not arbitrary queries). Inline comment warns future contributors. The gql.tada multi-schema mechanism — distinct `name` properties embedded in each generated introspection's `.d.ts` — is what produces the type isolation; U5's role is to prove the isolation holds, not to be the mechanism itself.                                                                                                                    |
| **Unit 3 lands and Unit 5 stalls indefinitely**: dual-client carries maintenance cost (two factories, two SDLs, two `.d.ts` files, AGENTS.md complexity) with zero callsites                                                               | If no consumer callsites adopt `adminGraphql()` within 8 weeks of U3 merge, revisit whether to revert U3 and reintroduce when Unit 5 is genuinely imminent. Add a 4-week checkpoint review to confirm Unit 5 timing.                                                                                                                                                                                                                                                                    |

---

## Documentation / Operational Notes

- AGENTS.md and CLAUDE.md updates land in U4 (no separate docs PR)
- ~~The U1 handoff document is the design-sync artifact referenced from the U3-U5 PR description~~ — U1 removed 2026-05-07; no handoff doc is created.
- Post-merge, no rollout or monitoring needed — this PR adds zero callsites and no runtime behavior

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-05-consumer-migration-implementer-brief-requirements.md](../brainstorms/2026-05-05-consumer-migration-implementer-brief-requirements.md)
- Related code: `packages/graphql/src/graphql.ts`, `packages/graphql/tsconfig.json`, `apps/cms/schema.graphql`, `apps/admin/src/graphql/schema.ts`
- Related external: gql.tada multi-schema docs; Pothos `printSchema(lexicographicSortSchema(...))` pattern
