# apps/admin — Forge Admin

## What this app does

Custom management platform — the strategic replacement for Strapi and
eventual home for the manager app. V1 ships the architecture (Next.js +
GraphQL Yoga + Pothos + Prisma + pgvector + useworkflow + Better Auth)
and proves it with real content types (Experiences, Videos) while Strapi
continues to serve existing consumers.

See the origin docs for full context:

- Requirements: `docs/brainstorms/2026-04-13-admin-app-graphql-postgres-requirements.md`
- Plan: `docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md`

## Stack

- Next.js 16+ App Router with TypeScript strict mode
- GraphQL Yoga + Pothos (with Prisma + scope-auth plugins) — single API at `/api/graphql`
- Prisma 6.x + PostgreSQL + pgvector (HNSW index) — sole data access layer
- Better Auth (DB-backed sessions) + server-side Firebase email/password fallback for transparent migration
- SSO via Better Auth native adapters: Google, Apple, Okta
- useworkflow (`workflow` npm package) for durable background jobs
- Upstash Redis (TCP / `ioredis`) for rate limiting
- Railway deployment (NIXPACKS, standalone output)
- Doppler for env var management (project: `forge-admin`)

## Folder structure

```
src/
  app/               Next.js App Router pages and API routes
  config/env.ts      Validated env (t3-oss/env-nextjs + zod)
  db/                Prisma client singleton + pgvector helpers         [Unit 2]
  auth/              Better Auth config + permissions + Firebase bridge [Units 5-6]
  graphql/           Pothos schema + resolvers                          [Units 3,4,6-9]
  services/          Business logic, raw SQL, ABAC checks               [Units 7-10]
  workflows/         Durable workflow definitions                       [Unit 11]
  storage/           Railway S3 adapter                                 [Unit 11]
```

## Build status

- [x] Unit 1: Scaffold + env + tests + lint + Railway config
- [ ] Unit 2: Prisma + pgvector
- [ ] Unit 3: GraphQL architecture spike
- [ ] Unit 4: Experience + Video Prisma models + Pothos types
- [ ] Unit 5: Better Auth + Firebase fallback
- [ ] Unit 6: Permission system + context + scope-auth
- [ ] Unit 7: Service layer + Experience CRUD
- [ ] Unit 8: Video + vector search + Experience embedding workflow
- [ ] Unit 9: GraphQL security hardening
- [ ] Unit 10: Core API sync
- [ ] Unit 11: useworkflow plugin + storage
- [ ] Unit 12: Admin dashboard (deferred — design via Stitch)
- [ ] Unit 13: CLAUDE.md playbook + reference-entity docs

## Conventions (Unit 1 baseline — expands with each unit)

- Env vars validated at startup via `src/config/env.ts`. Never read `process.env` directly.
- Env vars managed by Doppler (project: `forge-admin`). Use `pnpm fetch-secrets` for local dev.
- Tests colocated as `*.test.ts` / `*.test.tsx` beside source files.

## Development

```bash
pnpm fetch-secrets    # Pull .env from Doppler (forge-admin)
pnpm --filter @forge/admin dev           # http://localhost:3003
pnpm --filter @forge/admin build
pnpm --filter @forge/admin test
pnpm --filter @forge/admin lint
pnpm --filter @forge/admin typecheck
```

## Deployment

Railway service `forge-admin` (Doppler project of the same name).
Deployment caveats in `docs/solutions/deployment/nextjs-pnpm-monorepo-railway-standalone.md`
apply: set `HOSTNAME=0.0.0.0` in Railway dashboard (not `[deploy.env]`).

## Common pitfalls (grows with each unit)

- `[deploy.env]` in `railway.toml` is unreliable — put env vars in Railway dashboard.
- PostgreSQL 18 on Railway: `?::jsonb::text[]` cast unsupported. Use PG array
  literal `{val1,val2}` with `?::text[]` — helper to be added in Unit 2.
- Prisma 7.1.0 has pgvector migration regressions (Prisma issue #28867). Pin
  to Prisma 6.x until resolved.
