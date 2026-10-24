---
date: 2026-04-13
topic: admin-app-graphql-postgres
---

# Custom Admin App — Next.js + GraphQL + Postgres

## Problem Frame

Strapi v5 is too slow and constrained for our needs. Key friction: no DataLoader support, limited raw SQL access, dynamic zone relation bugs, poor extensibility. We need a custom platform with full control over the data model, API, query performance, and authorization.

This app is the strategic replacement for Strapi and the eventual home for the manager app. Long-term, it becomes the single GraphQL API for admin, `apps/web`, and `apps/mobile-v2`. The v1 scope is narrower (see "V1 vs Long-Term" below) — v1 establishes the architecture and proves it with real content types while Strapi continues serving existing consumers during the transition.

### V1 vs Long-Term

**V1 delivers:**

- Working architecture (Next.js + Yoga + Pothos + Prisma + pgvector + useworkflow)
- Experiences and Videos content types with a re-designed, AI-friendly data model
- Core API sync transforming Core data into the new model
- Better Auth + lazy Firebase migration
- RBAC + ABAC permission system including a PUBLIC tier for unauthenticated access
- Admin UI consumes the new GraphQL API
- Documentation that enables AI agents to extend the data model

**V1 does NOT replace Strapi in production:**

- `apps/web` and `apps/mobile-v2` continue consuming Strapi via `packages/graphql` (gql.tada)
- Strapi stays running in parallel during the transition
- `apps/manager/` continues reading from and writing to Strapi for enrichment jobs
- `packages/graphql` reconfiguration and consumer migration is a follow-up project

**Long-term (not v1):**

- Consumer migration: `apps/web` and `apps/mobile-v2` switch to the admin API
- Strapi decommission
- Manager app absorption — enrichment moves into admin app
- Data migration from Strapi to admin app Postgres

### Data Model Evolution

Core's data model reflects years of domain modeling work and remains a strong foundation — what's missing is AI-readiness. Core was designed before embeddings, semantic search, and agent-driven workflows became first-class concerns. Strapi layered its own constraints on top (dynamic zones, draftAndPublish plugin, i18n plugin), which produced friction.

V1 is the opportunity to redesign the shapes we control (Experiences and how Videos surface for search) with AI use cases as a first-class input, while respecting Core as the canonical source for video domain data. Core data is transformed during sync — not invented from scratch, not copied 1:1. Goals:

- Preserve Core's domain semantics (video variants, languages, keywords, editions) — don't re-invent them
- Optimize text representations for semantic embedding and agent comprehension (denormalize where it helps retrieval; keep relations where they help reasoning)
- Self-documenting Prisma schema with first-class localization (not bolted on via a plugin)
- Block-based composition for Experiences designed natively for Prisma (not Strapi's dynamic zone pattern)
- Shape the stored data so agents can extend it confidently (clear naming, explicit invariants, obvious extension points)

## Requirements

### Architecture

- R1. Single deployable Next.js App Router app at `apps/admin/`, deployed to Railway
- R2. GraphQL API via GraphQL Yoga + Pothos with Prisma plugin, exposed at `/api/graphql`
- R3. Prisma ORM as the primary data access layer. All CRUD and relations go through Prisma Client (including via Pothos Prisma plugin). Raw SQL is allowed only via `prisma.$queryRaw` inside services (see R8)
- R4. PostgreSQL with pgvector extension for vector similarity search
- R5. Strict separation of concerns: UI never touches DB directly; resolvers contain no business logic; service-layer owns mutations, raw SQL, and all permission checks; Pothos Prisma plugin handles read relation resolution (see R6, R7 for boundary)

### Data Access Patterns

- R6. Pothos Prisma plugin handles **read-side** relational fetching — resolvers accept `query` and pass `...query` through for selection optimization. This is the one allowed exception to "all DB access via services" and applies to nested relation resolution only.
- R7. Resolver pattern: read resolvers delegate to `ctx.services.<domain>.<method>({ query, input, user })` which internally uses `...query` in the Prisma call. Mutation resolvers always dispatch to services with no Prisma access. Nested field resolvers use Pothos `prismaField` with auth scopes applied at the type/field level.
- R8. Raw SQL via `prisma.$queryRaw` is allowed ONLY inside services (e.g., pgvector similarity queries). Raw SQL results must hydrate into full entities via a subsequent `findMany({ where: { id: { in: ids } }, ...query })` call — see "Search Hydration Pattern" in `CLAUDE.md`.
- R9. Query-level filtering for permissions — never fetch data and filter in application code. Permission WHERE clauses constructed in services; Pothos relation auth via `@pothos/plugin-scope-auth` or equivalent at the type level
- R10. Connection pooling tuned for Railway (max 5-10 connections). Use PgBouncer if needed for workflow+graphql+admin contention

### Authentication & Authorization

- R11. Better Auth as the identity system, database-backed in Prisma/Postgres. Provides login, sessions, and token management. Has Expo integration for mobile clients.
- R12. Lazy migration from Firebase Auth — on login, if user doesn't exist in Better Auth, verify their Firebase token (with `checkRevoked: true`) and create a linked Better Auth account. Map Firebase custom claims/roles to Better Auth roles. Log all migration events for audit.
- R12a. Firebase migration lifecycle: lazy migration continues until a sunset date (TBD). After sunset, Firebase tokens are rejected and inactive users must re-authenticate. The sunset date is set once the active-user migration rate levels off.
- R13. RBAC + ABAC permission system with four tiers: **ADMIN**, **EDITOR**, **VIEWER** (authenticated), and **PUBLIC** (unauthenticated — for `apps/web` and `apps/mobile-v2` public-facing queries). Permissions defined centrally in `/src/auth/permissions.ts`.
- R14. Permission functions combine role + ownership + state (e.g., `canEditExperience(user, experience)`, `canViewVideo(user | null, video)`). Functions must accept a nullable user to represent PUBLIC access; each function declares which operations are public-accessible.
- R15. Permissions enforced inside services. Every service method that reads or mutates data calls a permission function from `/src/auth/permissions.ts` before any Prisma call. No service method may bypass this.
- R15a. Permission matrix (full definition deferred to planning): must define for each content type × each role (ADMIN/EDITOR/VIEWER/PUBLIC) × each operation (read, create, update, delete) → allowed/denied. Provisional defaults: ADMIN can do everything; EDITOR can CRUD content they own or that's not yet published; VIEWER authenticated-only reads; PUBLIC reads published content only.

### API Transport & Security

- R16. The GraphQL endpoint MUST reject unauthenticated requests by default. A context middleware extracts the authenticated principal (Better Auth session or API token) before any resolver executes. Operations accessible to PUBLIC must be explicitly opted in — the default posture is authenticated-only.
- R17. GraphQL Yoga plugins enforce: (a) query depth limit (max 10), (b) query cost/complexity budget per request, (c) per-principal rate limiting, (d) introspection disabled in production
- R18. CORS policy: explicit allowlist of origins (admin UI, `apps/web`, `apps/mobile-v2` origins). No wildcard with credentials. Configured at the Yoga layer.
- R19. Workflow trigger endpoints under `/api/workflows/` must authenticate callers. External triggers (useworkflow callbacks) use `WORKFLOW_API_KEY`. Internal triggers from resolvers pass the authenticated user context. No workflow endpoint is publicly accessible.
- R20. Embedding vector columns are excluded from the Pothos type definitions entirely — not just hidden by convention. A test asserts no GraphQL type exposes vector fields.

### Background Processing

- R21. useworkflow (Workflow DevKit) for all async/background processing: embedding generation, import pipelines, Core sync, heavy operations
- R22. GraphQL never performs heavy work directly — it triggers workflows only
- R23. Workflows call services for all data access (not raw Prisma)
- R23a. useworkflow build plugin must be configured in `apps/admin/next.config.ts` and `WORKFLOW_API_KEY` provisioned as part of v1 setup. This is not inherited from `apps/manager/` — manager's workflow plugin is also not yet wired up. Without the plugin, workflows run as plain async functions (acceptable for local dev; not acceptable for production).

### V1 Content Types

- R24. **Experiences** — core content type with i18n (per-locale content), block-based composition, and vector embeddings for semantic search
- R24a. Experience i18n: localization is first-class. Exact modeling (per-locale rows vs JSONB vs locale relation) deferred to planning.
- R24b. Experience blocks: polymorphic block composition is required. Exact Prisma modeling (JSONB with Zod validation vs polymorphic relations vs separate block tables) deferred to planning.
- R25. **Videos** — media content type sourced from Core API sync, with `coreId`, `source` (`core` | `manager`), and variants as related records
- R26. Content CRUD mutations + vector similarity search. Search scope in v1: Experiences only (embeddings generated in admin app). Videos get standard filtered queries in v1; video embeddings remain in manager and move in a later phase.
- R27. Embedding generation workflow for Experiences (via useworkflow). Video embeddings stay in the manager pipeline for v1.
- R28. Draft/publish workflow for Experiences (maintains Strapi parity — editors need to stage content before making it public). Videos published on sync; no draft state.
- R29. Media/file handling: attachments (images, files) stored in Railway S3 (same pattern as `apps/manager`). Storage service abstracts upload/URL generation.

### Agent Productivity (Meta-Requirement)

- R30. The project must produce sufficient documentation and conventions that AI agents can extend the data model (add new content types, services, resolvers, permissions) without deep contextual knowledge. Deliverables:
  - `apps/admin/CLAUDE.md` with architecture rules, patterns, and the "how to add a new entity" playbook
  - Prisma schema with descriptive comments on every model and non-obvious field
  - One fully-documented reference entity (Experience) that agents use as a template
  - Naming conventions and file placement rules explicit enough that agents never have to guess
  - Security-by-default patterns: permission function template, vector field exclusion template, input validation template

### Video Ingestion (Core Sync)

- R31. Core API sync workflow — periodically pull video-related data from the JesusFilm Core API (`api-gateway.central.jesusfilm.org`) and **transform** it into the new AI-friendly data model (not 1:1 copy of Core's shape)
- R32. Sync covers all prerequisite reference data in dependency order: languages, countries, keywords, videos, video-variants (matching current `apps/cms/src/api/core-sync` phase order). Missing reference data causes FK violations.
- R33. All Core API responses validated against Zod schemas before persistence. Malformed or unexpected payloads logged and rejected.
- R34. Core sync runs as a useworkflow background job, not inline in the GraphQL layer
- R35. `apps/manager/` continues to query and write to Strapi during v1. Manager migration to admin app is a follow-up project. This means Strapi stays running in parallel; no cutover in v1.

## Success Criteria

- GraphQL endpoint serves Experience and Video queries without N+1s, verified by Prisma query logging in test runs
- Vector search returns Experiences using cosine similarity via raw SQL in a service, then hydrates via Prisma `findMany` with `...query`
- No direct DB access from UI components or resolvers (excepting Pothos Prisma plugin for reads)
- No business logic in resolvers — every resolver is a one-liner dispatching to a service or `prismaField`
- Permission checks on every service method, including explicit PUBLIC paths
- GraphQL endpoint rejects unauthenticated requests by default
- Rate limiting, query depth limits, and CORS enforced
- Firebase users can log in via lazy migration with revocation checking
- Core sync transforms and upserts all 5 reference data phases without FK errors
- An AI agent can add a new content type by following the CLAUDE.md playbook and the Experience reference, without asking clarifying questions
- No GraphQL type exposes embedding vector fields (test asserts this)

## Scope Boundaries

- Prisma only — no Drizzle, no Knex
- V1 admin UI only — `apps/web` and `apps/mobile-v2` continue on Strapi. `packages/graphql` reconfiguration is a follow-up.
- Strapi stays running in parallel during v1. Strapi decommission is out of scope.
- No Strapi data migration in v1 (greenfield data model). Data migration from Strapi to admin app Postgres is a separate project.
- Video enrichment (transcription, chapters, embeddings) stays in `apps/manager/` — manager writes to Strapi, not admin app
- Manager app absorption is long-term, not v1
- No SSR for admin UI beyond Next.js App Router defaults
- Video vector search is out of scope for v1 (embeddings stay in manager pipeline)

## Key Decisions

- **Strapi stays during transition:** Admin app runs in parallel with Strapi. Consumers migrate in a follow-up project.
- **Data model evolution:** Core's domain model is respected as canonical; the redesign targets AI-readiness (embeddings, agent comprehension) and sheds Strapi's plugin-layered workarounds. Core sync transforms rather than copies.
- **Single API (eventual):** One GraphQL endpoint will serve admin, web, and mobile eventually. In v1, only admin UI consumes it.
- **Better Auth + Firebase lazy migration:** Firebase is used externally (not in this repo); lazy migration links accounts at first login.
- **PUBLIC access tier:** Four-tier permission model (ADMIN/EDITOR/VIEWER/PUBLIC) accommodates unauthenticated queries from public web/mobile — critical when consumers eventually switch.
- **Pothos plugin for reads, services for writes:** Read resolvers delegate to Pothos with `...query`; mutations always go through services; permission checks at service + type/field level.
- **useworkflow:** Admin app wires up the workflow build plugin independently; not copying from manager (manager's plugin isn't configured either).
- **Agent-first documentation:** Documentation is a first-class deliverable, not an afterthought.
- **Security by default:** Auth required, rate limited, CORS allowlisted, embeddings never exposed, inputs validated.

## Dependencies / Assumptions

- PostgreSQL instance with pgvector extension on Railway
- pnpm workspace already configured for `apps/*`
- Firebase Admin SDK available for token verification during lazy migration (Firebase used by external/legacy systems)
- useworkflow build plugin and `WORKFLOW_API_KEY` must be provisioned for production; local dev falls back to plain async
- Better Auth Expo integration available for `apps/mobile-v2`
- Railway S3 available for media storage (same setup as `apps/manager`)
- Secrets managed per existing pattern (Doppler + Zod env validation — see `apps/manager/src/config/env.ts`)

## Outstanding Questions

### Deferred to Planning

- [Affects R24, R25][Needs research] Design the AI-friendly data model for Experiences and Videos. How to model i18n (per-locale rows vs JSONB vs locale relation)? How to model polymorphic blocks (JSONB + Zod vs polymorphic relations)? What does Core data transformation look like?
- [Affects R10][Needs research] Prisma connection pool configuration for Railway (connection_limit, pool_timeout, PgBouncer)
- [Affects R11][Needs research] Better Auth configuration — session strategy (JWT vs database sessions), social providers, Expo integration setup
- [Affects R12][Technical] Firebase lazy migration flow — token verification with revocation, role mapping, account linking in Better Auth
- [Affects R16, R13][Technical] How `apps/web` and `apps/mobile-v2` will eventually authenticate to the admin API when they migrate — shared Better Auth sessions, API tokens, or both?
- [Affects R15a][User decision] Finalize the permission matrix (ADMIN/EDITOR/VIEWER/PUBLIC × content type × operation)
- [Affects R23a][Technical] useworkflow build plugin setup — exact `next.config.ts` configuration, API key provisioning, behavior under load
- [Affects R31-R33][Needs research] Core API sync transformation — map Core entity shapes into the AI-readied presentation layer. Preserve Core's domain semantics (variants, languages, keywords, editions). Examine `apps/cms/src/api/core-sync` for sync semantics (pagination, incremental watermarks, soft-delete) — these are battle-tested patterns, not Strapi artifacts.
- [Affects R30][Technical] Exact CLAUDE.md structure and "add a new entity" playbook content — defined during implementation as patterns emerge
- [Affects Architecture][Needs research] Spike: stand up a minimal Yoga + Pothos + Prisma endpoint with one entity to verify `...query` pattern works with Next.js App Router route handlers before building the full system
- [Affects R17][Needs research] Choose specific Yoga plugins for depth/complexity limits and rate limiting (graphql-armor, envelop plugins)

## Project Structure

```
apps/admin/
  /app
    /api/graphql/route.ts       # GraphQL Yoga endpoint
    /api/workflows/             # Workflow DevKit routes (auth-gated)
    /api/auth/                  # Better Auth routes
    /dashboard/                 # Admin UI routes
  /prisma
    /schema.prisma              # Prisma schema (with comments)
    /migrations/                # Prisma migrations
  /src
    /db/                        # Prisma client singleton
    /graphql/                   # Pothos schema + resolvers
    /services/                  # Mutations, raw SQL, permission checks
    /workflows/                 # Workflow DevKit flows
    /auth/                      # Better Auth config + permissions.ts + Firebase bridge
    /config/                    # Env validation (Zod)
    /storage/                   # Railway S3 adapter
  /CLAUDE.md                    # Agent playbook
```

## Anti-Patterns (Enforced by Convention and CLAUDE.md)

- Prisma calls inside resolvers (except `...query` passthrough via Pothos Prisma plugin for reads)
- Raw SQL outside services
- Business logic in GraphQL resolvers
- N+1 queries (loop over Prisma calls in nested resolvers)
- UI directly calling database
- Workflows duplicating logic from services
- Fetch-then-filter for permission checks
- Embedding vectors exposed in any GraphQL type
- Unauthenticated requests reaching resolvers (transport layer must enforce)
- External API data persisted without Zod validation
- Mirroring Strapi's plugin-shaped content structures (dynamic zones, i18n plugin tables) — design natively for Prisma
- Re-inventing Core's domain shapes (languages, keywords, variants, editions) — preserve Core's semantics, adapt presentation

## Next Steps

-> `/ce:plan` for structured implementation planning
