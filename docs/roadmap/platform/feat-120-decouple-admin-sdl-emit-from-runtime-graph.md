---
id: "feat-120"
title: "Decouple admin SDL emit from runtime graph"
owner: "urim"
priority: "P2"
status: "not-started"
start_date: "2026-06-01"
duration: 3
depends_on: []
blocks: []
tags:
  - "admin"
  - "graphql"
  - "infrastructure"
---

## Problem

`apps/admin/src/scripts/print-schema.ts` imports `@/graphql/schema` to obtain the Pothos schema for SDL emission. That import transitively pulls 19 side-effect imports — every mutation and query module — which in turn pull service modules, which import `@/config/env` (zod validation) and construct the Prisma client at module load time.

The script works today because:

- CI sets `CI=true`, and `apps/admin/src/config/env.ts:154` reads `skipValidation: !!process.env.CI`. zod validation is bypassed.
- Local dev contributors who maintain a populated `.env` have all required env vars present.

Two latent risks identified in the multi-agent code review of `feat/dual-client-codegen-unit-3`:

1. **Future side-effect imports propagate.** A new service that validates a third-party API key on module load, or a top-level `await fetch(...)` for runtime config, would be triggered every time `pnpm schema:print` runs in CI — including in PRs that don't touch the new service. The SDL emit should be schema-only, not a full app boot.

2. **Brittle bypass.** If env-validation policy ever tightens (e.g. `skipValidation` is removed for security reasons, or made more restrictive), the `admin-schema-drift` CI job breaks for every PR until the underlying decoupling lands.

Local-dev friction is the third concern, but it's lower-priority — contributors can run `pnpm fetch-secrets` once.

Source: review finding #6 from the multi-agent code review on PR for `feat/dual-client-codegen-unit-3` (deferred during the fix pass on 2026-05-07). Origin brief: `docs/brainstorms/2026-05-05-consumer-migration-implementer-brief-requirements.md`.

## Entry Points — Read These First

1. `apps/admin/src/scripts/print-schema.ts:25` — the `import { schema } from "@/graphql/schema"` line, the entry point for the side-effect cascade.
2. `apps/admin/src/graphql/schema.ts` — assembles the schema; 19 side-effect imports of types + mutations + queries.
3. `apps/admin/src/graphql/builder.ts` — `new SchemaBuilder<...>` config, imports `@/db/client` (constructs Prisma) and `@/auth/permissions`.
4. `apps/admin/src/db/client.ts` — Prisma client singleton + embedding-guard extension.
5. `apps/admin/src/config/env.ts:154` — `skipValidation: !!process.env.CI` (the current bypass).
6. `apps/admin/src/graphql/mutations/manager-enrichment.ts` — example of a mutation module that pulls a service which pulls env.

## Grep These

```bash
grep -rn "^import" apps/admin/src/graphql/schema.ts          # the side-effect chain
grep -rn "from \"@/services" apps/admin/src/graphql/         # which mutations import services
grep -rn "from \"@/config/env\"" apps/admin/src/services/    # which services pull env
grep -rn "skipValidation" apps/admin/src/config/env.ts       # the bypass
```

## What To Build

The goal is a `print-schema.ts` whose imports trigger Pothos type registration but NOT runtime concerns (Prisma client construction, env validation, service module side effects).

Two candidate strategies — pick during planning:

**Strategy A: Move type registration into a dedicated module**

- Create `apps/admin/src/graphql/build-schema.ts` that exports a `buildSchema()` function.
- The function imports the type modules (registering them on a fresh builder), then returns `builder.toSchema()`.
- Refactor `apps/admin/src/graphql/builder.ts` to NOT import `@/db/client` at module load. Lazy-construct the Prisma plugin's runtime dependencies inside the request context, not at builder instantiation.
- `print-schema.ts` calls `buildSchema()` directly without touching the runtime path.

**Strategy B: Conditional builder construction**

- Add a `BUILDER_MODE` env var with values `"runtime" | "sdl-emit"`.
- In `sdl-emit` mode, builder.ts skips the Prisma plugin and any plugin that requires runtime dependencies.
- `print-schema.ts` sets `BUILDER_MODE=sdl-emit` before importing `@/graphql/schema`.
- Trade-off: emitted SDL must still match runtime SDL byte-for-byte, so any difference between the two modes is a defect.

Strategy A is cleaner architecturally. Strategy B is faster to ship but adds a configuration dimension to admin's bootstrap.

## Constraints

- Do NOT remove `skipValidation: !!process.env.CI` until the decoupling lands. The bypass is currently load-bearing for the `admin-schema-drift` CI job.
- The emitted SDL must remain byte-for-byte identical to the current artifact. CI's `admin-schema-drift` job catches drift; this work must not introduce drift.
- Pothos type registration order is load-bearing. `apps/admin/src/graphql/schema.ts` documents `reference.ts` must import first; preserve that property in any refactor.
- `apps/admin/src/graphql/types/experience.ts` and other type modules currently call `builder.prismaObject(...)` — Strategy A's refactor must not break this surface.

## Verification

1. `pnpm --filter @forge/admin schema:print` runs successfully WITHOUT a populated `.env` (no `DATABASE_URL`, no `BETTER_AUTH_SECRET`, etc.) and WITHOUT `CI=true`.
2. The emitted `apps/admin/schema.graphql` is byte-for-byte identical to the current committed artifact (no SDL drift).
3. `apps/admin` typecheck still passes.
4. `pnpm --filter @forge/admin dev` still starts successfully (runtime path not regressed).
5. Add a unit test asserting that loading `apps/admin/src/graphql/schema.ts` (or whichever module print-schema imports) does NOT construct a Prisma client — e.g., spy on the Prisma client constructor and assert zero calls during the import.
6. CI's `admin-schema-drift` job continues to pass on a PR that touches Pothos types.
