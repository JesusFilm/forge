# apps/admin — Forge Admin

## What this app does

Custom management platform — the strategic replacement for Strapi and
eventual home for the manager app. V1 ships the architecture (Next.js +
GraphQL Yoga + Pothos + Prisma + pgvector + useworkflow + Auth SSO)
and proves it with real content types (Experiences, Videos).

See the origin docs for full context:

- Requirements: `docs/brainstorms/2026-04-13-admin-app-graphql-postgres-requirements.md`
- Plan: `docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md`
- V1 operational surfaces: `apps/admin/docs/v1-operational-surfaces.md`
- Worktree preview setup: `apps/admin/docs/worktree-preview-setup.md`

## Stack

- Next.js 16+ App Router with TypeScript strict mode
- GraphQL Yoga + Pothos (with Prisma + scope-auth plugins) — single API at `/api/graphql`
- Prisma 6.x + PostgreSQL + pgvector (HNSW index) — sole data access layer
- Admin login goes through the standalone `apps/auth` OAuth/OIDC provider and
  creates an admin-local signed session. Admin must not depend on shared
  `.jesusfilm.org` cookies or host admin-local credential handlers.
- useworkflow (`workflow` npm package) for durable background jobs
- Redis (TCP via `ioredis`) for rate limiting
- Railway deployment (NIXPACKS, standalone output)
- Doppler for env var management (project: `forge-admin`)

## Embedding ownership

Mastra owns background transcript and experience embedding generation:
provider calls, provider-result validation, retries, workflow diagnostics, and
Studio observability. Admin owns the remaining type-specific ingest routes,
target resolution, vector storage, publication gates, pgvector indexes, public
search contracts, and retrieval. The legacy scene embedding writer and Admin
scene ingest route are retired; historical scene rows stay in Postgres until
feat-199 decides retention/migration. Scene analysis artifacts are non-search
source artifacts, not a scene-vector pipeline.
Coordinated all-content content-vector replacement uses
`run-embeds --pipeline=all` only after a passed Mastra content search-eval gate
report from `docs/search-eval-reports/`.

Live user search stays Admin-owned. Search services may generate live query
embeddings for retrieval, but live search orchestration does not move to
Mastra.

## AI experience draft generation — structural validity & gateway-trust gate

The "create full experience draft" editor action
(`src/app/dashboard/experiences/generate-draft-action.ts` →
`src/mastra/workflows/multi-step-draft-workflow.ts`) layers defense so a
generated draft is never off-shape: two-phase generation (skeleton → validate
→ sequential fill), deterministic coercion, optional per-phase
schema-constrained decoding, and a fail-closed validate→repair loop that
always re-validates the assembled output against the persistence-layer
`BlocksSchema` (`@/domain/blocks`) plus the single-sourced
`GENERATION_MIN_BLOCKS`. The generation minimum is enforced ONLY on the
generation path — `BlocksSchema` itself stays permissive so legitimate manual
1-block experiences still persist.

### Constrained-decoding trust flag

`AI_GATEWAY_CONSTRAINED_DECODING_TRUSTED` (env, `z.enum(["true","false"])`,
`.optional().default("false")`) marks a provider's schema-constrained decoding
as trusted. It stays `"false"` until a GREEN smoke run — with the AI gateway
enabled AND constrained decoding turned on — confirms the provider honors
schema-constrained decoding for the experience schema. The default mode
(Gemini, free-text) never depends on it: coercion + repair + the BlocksSchema
validator carry the final guarantee regardless of the flag.

### Structural-validity smoke gate

`pnpm --filter @forge/admin smoke:draft-workflow`
(`src/scripts/smoke-mastra-draft-workflow.ts`) is a REAL-LLM harness (requires
`OPENROUTER_API_KEY`). It runs the `multi-step-draft` workflow over a committed
prompt set and asserts the FULL structural guarantee per prompt: the workflow
draft passes `DraftExperienceSchema` AND `normalizeExperienceDraft(draft,
candidates)` succeeds — i.e. the assembled output also satisfies `BlocksSchema`
plus the generation minimum, the same boundary the action enforces before
persisting. It reports a per-prompt split (`firstPassValid` /
`recoveredAfterRepair` / `terminalFail`) and exits non-zero on any
terminal-fail. `recoveredAfterRepair` is always 0 here: the repair loop lives
in `runGenerateDraftAction`, not in the workflow this harness drives directly —
repair-recovery is covered by the action-level tests
(`generate-draft-action.test.ts` / `repair-draft.test.ts`).

Gateway-verification procedure: to authorize trusting a provider's constrained
decoding (R6), run this smoke with the gateway enabled and constrained decoding
on. A green run (zero terminal-fails) proves the provider's constrained output
survives the full post-normalize `BlocksSchema` boundary — not just
`DraftExperienceSchema` — and is the gate that authorizes flipping
`AI_GATEWAY_CONSTRAINED_DECODING_TRUSTED=true` for that provider. The smoke
assertion is intrinsic to `smoke:draft-workflow` (same harness, same run, no
opt-in path), so there is no separate `smoke:draft-structural` script.

## Experience draft/chat — standalone Mastra consolidation

The AI draft-authoring + chat **generation** is being moved out of admin's
in-process `src/mastra` singleton into the standalone `@forge/mastra` Railway
service, reached over authenticated HTTP (plan
`docs/plans/2026-06-19-001-feat-mastra-admin-to-standalone-consolidation-plan.md`).
Admin stays the caller/proxy and keeps data ownership; Mastra is the generator.

**Flag-gated, in-process fallback retained.** Two independent flags flip admin
from the in-process agents/workflows to the remote service; both default off, so
the in-process path under `src/mastra` is still the live fallback and is NOT
deleted until both flags are stable in prod:

- `EXPERIENCE_AI_REMOTE_DRAFT` (`"true"`/`"false"`, default `"false"`) — the
  one-shot "Generate full page"/"Quick draft" path. When on,
  `runGenerateDraftAction` calls `mastra-experience-draft-client.ts`
  (`POST /forge-experience-draft`, reusing `MASTRA_BASE_URL` +
  `MASTRA_SERVICE_API_KEY`); candidates + exemplar are still computed admin-side
  and shipped keyed on `videoId`; `config_missing` degrades to in-process; other
  remote failures map to the editor error surface (no retry storm).
  `MASTRA_DRAFT_TIMEOUT_MS` (default 200s) stays strictly larger than mastra's
  internal 180s workflow budget.
- `EXPERIENCE_AI_REMOTE_CHAT` (`"true"`/`"false"`, default `"false"`) — the
  streaming chat turn. When on, `runMastraChat` relays the token stream from
  `POST /forge-experience-chat` via `mastra-experience-chat-client.ts` (admin =
  SSE proxy); SSRF host allowlist (`MASTRA_CHAT_ALLOWED_HOSTS`) checked before
  fetch, `redirect:"error"`, `MASTRA_CHAT_TIMEOUT_MS` (default 95s, > mastra's
  90s `chatTurn`) composed with `request.signal` so a closed tab cancels the
  upstream run. A remote `timeout` stays `timeout`; the `done` event keeps
  `producedBy` so 👍/👎 ratings still attach. `config_missing` degrades to
  in-process; `MASTRA_CHAT_BASE_URL` + `MASTRA_CHAT_API_KEY` reuse mastra's
  `MASTRA_SERVICE_API_KEYS`.

**Stays admin (data ownership):** video-candidate retrieval, exemplar selection
(pgvector + embeddings), draft re-validation/normalization (`@/domain/blocks`
`BlocksSchema` + `normalizeExperienceDraft` + the repair loop), persistence +
ContentRevision + ABAC, chat history, the `chat-thumb-rating` scorer + Mastra
scores store + rating routes, and the editor SSE route + the 4-variant
`ChatStreamEvent` union (in `experience-ai-chat.service.ts`). The dead
7-variant `chat-stream-event.ts` + `streaming-bridge.ts` were removed in U10.

**Agent-tool receiver (mastra → admin).** The remote chat agent's tools call
admin back over HTTP — bearer-gated `POST /api/internal/agent-tools/{search-videos,
lookup-bible-verse,fetch-video-image}` (`src/app/api/internal/agent-tools/`,
`isValidAgentToolsBearer`). Every load-bearing filter/cap is enforced
server-side (the mastra caller is untrusted): search `contentTypes:["video"]` +
`playbackId !== null`; bible OR-match + locale-fallback `displayName`; image
`VARIANT_PRIORITY`. The new receiver CSV `ADMIN_AGENT_TOOLS_API_KEYS` joins the
boot-time `assertBearerCsvsDisjoint` invariant.

**Deploy ordering (keyring-first).** For the agent-tool direction, deploy
admin's `ADMIN_AGENT_TOOLS_API_KEYS` + endpoints (receiver) BEFORE mastra's
`ADMIN_AGENT_TOOLS_URL`/`_API_KEY` (caller); verify `503/401 → 200`. For the
draft/chat triggers, `MASTRA_SERVICE_API_KEYS` already exists on mastra — deploy
the `/forge-experience-*` routes before flipping admin's flag.

**Shared generation contract.** The LLM draft schema is single-sourced in
`@forge/experience-schema` (pure zod) and consumed by both admin's re-validator
and the standalone generator so they cannot drift.

## Folder structure

```
src/
  app/               Next.js App Router pages and API routes
  config/env.ts      Validated env (t3-oss/env-nextjs + zod)
  db/                Prisma client singleton + pgvector helpers         [Unit 2]
  auth/              Auth SSO client, local session, and permissions    [Units 5-6]
  graphql/           Pothos schema + resolvers                          [Units 3,4,6-9]
  services/          Business logic, raw SQL, ABAC checks               [Units 7-10]
  workflows/         Durable workflow definitions                       [Unit 11]
  storage/           Railway S3 adapter                                 [Unit 11]
```

## Build status

- [x] Unit 1: Scaffold + env + tests + lint + Railway config
- [x] Unit 2: Prisma + pgvector
- [x] Unit 3: GraphQL architecture spike — **signed off against a live Postgres 2026-04-13**
- [x] Unit 4: Experience + Video Prisma models + block Zod union + Pothos types
- [x] Unit 5: Auth SSO relying-client session
- [x] Unit 6: Permission system + per-request DataLoaders + scope-auth wiring + classification enforcement
- [x] Unit 7: Service layer + Experience CRUD with ABAC
- [x] Unit 8: Video read service + pgvector experience search
- [x] Unit 9: GraphQL security hardening (Armor + rate limit + introspection gate + CORS) — Armor's `costLimitPlugin` is deliberately omitted because it false-positives on typed-client fragment composition; see `docs/solutions/tooling-decisions/graphql-armor-cost-limit-incompatible-with-typed-clients-20260514.md`
- [x] Unit 10: Core API sync orchestrator + 5 phases
- [x] Unit 11: useworkflow plugin + workflow endpoint auth + storage service
- [x] Unit 12: Admin dashboard operationalized for v1 (no stub routes; live ops surfaces)
- [x] Unit 13: CLAUDE.md playbook + add-a-new-entity guide + pattern docs

## Permission system (Unit 6)

Two layers, kept deliberately separate:

1. **`hasPermission(user, key)`** in `src/auth/permissions.ts` — coarse
   tier-only gate consulted by Pothos scope-auth
   (`authScopes: { hasPermission: 'read:experiences' }`). Resolves a
   `PermissionKey` against a 4-tier ladder (PUBLIC → VIEWER → EDITOR →
   ADMIN, plus orthogonal SYSTEM workflow tier). ADMIN is the operational
   override and satisfies SYSTEM gates too. Adding a new permission key
   requires a matrix entry in the same file — TypeScript compile error
   if missing.

2. **Named ABAC helpers** (`canEditExperience(user, experience)`,
   `canPublishExperienceLocale(...)`, etc.) — fine-grained, accept the
   entity in question, encode ownership and state rules. Service code
   MUST call these at the top of every mutation. The convention will be
   testable once Unit 7 services exist.

Service-layer rule (lands in Unit 7):

```ts
async updateExperienceLocale(input, user) {
  const before = await prisma.experienceLocale.findUniqueOrThrow(...)
  if (!canEditExperienceLocale(user, before)) throw new ForbiddenError()
  return prisma.$transaction(async (tx) => { ... })
}
```

Pothos type classification is enforced by
`src/graphql/classification.test.ts`:

- Every `builder.prismaObject(...)` call must have a JSDoc
  `@classification abac-gated` or `@classification public-shape` tag.
- No `public-shape` type may have a `t.relation(...)` whose target is
  `abac-gated` — that would let a public read reach ABAC-gated data
  without ABAC. Add the relation to the test's per-parent registry when
  exposing a new abac-gated relation.
- The runtime ABAC parity test — for every abac-gated type, assert that
  `Query.t(id)` and every `X.t` / `X.ts` relation path that reaches that
  type return the same row set for the same principal against a live
  seeded Postgres — is a `test.todo` placeholder until Unit 7 services
  exist. Once services land, the todo becomes a DB-backed test seeded
  with ≥1 row the caller should see and ≥1 row they should NOT see (per
  principal). A divergence means a relation is bypassing the service's
  ABAC WHERE.

Per-request DataLoaders live in `src/graphql/loaders.ts` and are
instantiated by `createContext` once per request. Use them in services
that hydrate by id outside the Pothos `...query` happy path (e.g., the
vector-search Search Hydration Pattern).

**When to add a new loader:**

1. Your service returns IDs (not rows) — usually from raw SQL or an
   external ID list (embedding search, recommendation engine, Core sync
   returning `coreId` lists).
2. Callers need the hydrated Prisma row, not just the id.
3. The same request likely hydrates more than one id — batching is what
   earns DataLoader its keep.

Recipe:

```ts
// src/graphql/loaders.ts — add inside createLoaders return object.
myEntityById: new DataLoader<string, MyEntityRow | null>(async (ids) => {
  const rows = await prisma.myEntity.findMany({
    where: { id: { in: ids as string[] } },
  })
  return mapToInputOrder(ids, rows, (r) => r.id)
}),
```

Then call `ctx.loaders.myEntityById.load(id)` from the service. Never
cache loader instances across requests — `createContext` builds fresh
instances per request so one principal's cached row never leaks to
another principal's query.

**When NOT to add a loader:** if your access path is `Query.x(id)` →
Pothos resolver → Prisma with the Pothos `...query` argument, the Prisma
plugin already issues a single batched query. Adding a DataLoader on top
is redundant and loses the plugin's column-pruning.

## Conventions (Unit 1 baseline — expands with each unit)

- Env vars validated at startup via `src/config/env.ts`. Never read `process.env` directly.
- Env vars managed by Doppler (project: `forge-admin`). Use `pnpm fetch-secrets` for local dev.
- Tests colocated as `*.test.ts` / `*.test.tsx` beside source files.
- **Adding a new Pothos type** requires three steps:
  1. Create `src/graphql/types/<name>.ts` and call `builder.prismaObject(...)`
  2. Add a side-effect import in `src/graphql/schema.ts` so the type registers on the builder before `builder.toSchema()` runs
  3. Order matters: `src/graphql/types/reference.ts` must be imported first because it registers the shared `JSON` scalar and `LocaleStatusEnum`. Other type files import from `reference.ts` to reuse them.
     Forgetting step 2 produces a silent omission — no build error, just a missing type at runtime.

## Development

```bash
pnpm fetch-secrets    # Pull .env from Doppler (forge-admin)
pnpm --filter @forge/admin dev           # http://localhost:3003
pnpm --filter @forge/admin build
pnpm --filter @forge/admin test
pnpm --filter @forge/admin lint
pnpm --filter @forge/admin typecheck
```

### Seeding fixtures for local web dev

Use this when you need an admin DB with enough content for apps/web to
render every page locally.

```bash
DATABASE_URL='postgresql://forge:forge@localhost:5433/forge_admin' \
pnpm --filter @forge/admin seed-web-fixtures
```

Idempotent — running twice produces no duplicates. The script refuses
to run when `DATABASE_URL` points at any Railway prod host or any
`*.jesusfilm.org` host; the guard is fail-closed (unparseable URLs are
also refused). Fixture data lives at
`apps/admin/src/scripts/web-fixtures.json` — edit there to add content,
not in the script.

### Web ISR revalidation webhook (U21)

`apps/admin/src/services/revalidate-webhook.ts` emits ISR refresh hints
to web on Experience publish / update / archive and broad watch video-data
changes from Core sync. Best-effort:
`emitRevalidateWebhook` catches every failure mode (config missing, 5xx,
network, timeout) and is called via `void` so admin's publish UX never
blocks on web. Wired into `ExperienceService.publishLocale`,
`updateLocale` (only when `status === "PUBLISHED"`), and `archive`.

Env vars on the `forge-admin` Doppler project (both `.optional()` so
admin still boots in environments without web wired up):

- `WEB_REVALIDATE_URL` — e.g. `https://web.jesusfilm.org/api/revalidate`
- `WEB_REVALIDATE_TOKEN` — must hold the SAME value web sets in
  `REVALIDATION_SECRET`

Deploy ordering (receiver-first, per
`docs/solutions/architecture-patterns/consumer-bearer-rate-limit-identity-pattern-20260513.md`):

1. Confirm `REVALIDATION_SECRET` is set on web (likely already, from
   the Strapi era).
2. Set `WEB_REVALIDATE_URL` + `WEB_REVALIDATE_TOKEN` on admin to match.
   Until both are set, `emitRevalidateWebhook` silently no-ops with a
   structured log per attempt (`event=web_revalidate.skipped
reason=config_missing`).
3. Verify end-to-end: publish an Experience, fetch the matching public watch URL
   such as `/watch/jesus.html/english.html`, and confirm refresh. Tail admin logs for
   `event=web_revalidate.sent httpStatus=200`. Web's receiver invalidates
   route paths with `revalidatePath` and resolver Data Cache entries with
   `revalidateTag(tag, { expire: 0 })`.

Reversing the order produces a dead minute where admin's first call 401s
against an unconfigured web. The webhook itself swallows the 401, so the
symptom is "web pages don't update after publish" with no error surface.

### Watch route manifest snapshot

Admin owns the public watch-route admission manifest at
`GET /api/watch-route-manifest`. The route requires the normal consumer
bearer and returns the latest persisted snapshot with `ETag` support; if no
snapshot exists, it returns a controlled 503 instead of generating on demand.

Snapshot fields the web branch can rely on:

- `contentSlugs` — all public two-segment content slugs: playable videos,
  parent videos with playable children, and published one-segment
  experiences.
- `oneSegmentSlugs` — published non-template, non-homepage experiences whose
  public route is exactly one segment.
- `episodePairsByParent` — compact parent slug to playable child slugs map for
  three-segment episode routes.
- `audioLanguageSlugs` — language slugs that have at least one published HLS
  dub on a non-deleted video.
- `version` and `generatedAt` — stable cache/revalidation metadata.

Refresh triggers:

- Core sync phases `languages`, `videos`, and `video-dubs`.
- Experience locale publish/update/archive flows that can change public route
  visibility.
- Operator refresh script:

```bash
DATABASE_URL='postgresql://forge:forge@localhost:5433/forge_admin' \
pnpm --filter @forge/admin watch-route-manifest:generate
```

The script prints summary-only JSON by default: version, generated timestamp,
payload size, counts, and duration. Use `--print` only for local debugging when
the full manifest payload is intentionally needed. Like `seed-web-fixtures`, it
refuses production-like `DATABASE_URL` hosts (`*.railway.app`,
`*.jesusfilm.org`, and unparseable URLs) so operators do not accidentally mutate
production snapshots from a workstation.

Core sync also has a broader watch-render invalidation set: `languages`,
`videos`, `video-images`, `video-editions`, `video-subtitles`, `video-dubs`,
and `video-dub-downloads`. When any of those phases run, admin emits a broad
`model: "video"` webhook with no slug so web clears video, series, child-dub,
and home resolver caches even when the manifest itself does not need refreshing.

### Watch SEO sitemap manifest snapshot

Admin owns the Watch sitemap-only hreflang manifest at
`GET /api/watch-seo-manifest`. The route requires the normal consumer bearer
and returns the latest persisted snapshot with `ETag` support; if no snapshot
exists, it returns a controlled 503 instead of generating on demand.

This manifest is deliberately separate from the route manifest. The route
manifest stays a compact route-admission contract; the SEO manifest carries
only sitemap rendering data for public Watch video and episode URLs.

Snapshot fields the web branch can rely on:

- `videoRouteGroups` — public two-segment Watch content slugs and valid
  Google-supported hreflang alternates with their public audio language slugs.
- `episodeRouteGroups` — parent/child Watch episode slug pairs and valid
  Google-supported hreflang alternates with their public audio language slugs.
- `skippedHreflangValues` — aggregate counts for duplicate, missing, or
  unsupported language tags skipped during generation.
- `version` and `generatedAt` — stable cache/revalidation metadata.

Refresh triggers:

- Core sync phases `languages`, `videos`, and `video-dubs`.
- Operator refresh script:

```bash
DATABASE_URL='postgresql://forge:forge@localhost:5433/forge_admin' \
pnpm --filter @forge/admin watch-seo-manifest:generate
```

The script prints summary-only JSON by default: version, generated timestamp,
payload size, counts, and duration. Use `--print` only for local debugging when
the full manifest payload is intentionally needed. Like the route-manifest
script, it refuses production-like `DATABASE_URL` hosts (`*.railway.app`,
`*.jesusfilm.org`, and unparseable URLs) so operators do not accidentally mutate
production snapshots from a workstation.

### Video database backup and clone

Production backup is automated only. Do not add or use an operator
`backup:video-db` script. Run Postgres World from a dedicated admin worker
Railway service, not from the traffic-serving admin web service. Both services
can use the same admin build/start command, but only the worker should set
`WORKFLOW_RUNNER_ENABLED=true`; web should leave it unset or `false` so web
replicas can scale on traffic without also running jobs. When the worker boots,
`src/instrumentation.ts` starts Postgres World and ensures one
`src/workflows/videoDbBackup.ts` scheduler workflow is running. That scheduler
workflow runs one backup immediately when it is first created, then sleeps until
the next daily UTC run and repeats on that cadence. The actual `pg_dump` and S3
upload run inside Postgres World, and each backup gets a `workflow_run` ledger
row visible in `/dashboard/workflows`. The job backs up the default
`video-core` profile and uploads to the normal Railway S3 bucket env vars
already managed through Doppler/Railway:
`RAILWAY_S3_BUCKET`,
`RAILWAY_S3_ENDPOINT`, `RAILWAY_S3_REGION`, `RAILWAY_S3_ACCESS_KEY_ID`, and
`RAILWAY_S3_SECRET_ACCESS_KEY`. Backups upload under the fixed
`admin-video-db-backups/<profile>/` prefix.

The schedule is fixed in code at daily 09:00 UTC. The admin Railway image gets
PostgreSQL 18 client tools from the admin service's Railpack variable
`RAILPACK_PACKAGES=postgres@18.1`; keep that in sync with the managed database
major version because `pg_dump` cannot dump from a newer server. Railpack's
Mise Postgres package compiles from source, so the services also need
`RAILPACK_BUILD_APT_PACKAGES=bison flex`. Because this monorepo has multiple
Railway services, do not put a root Railpack config in place for this feature
unless every service should inherit it. Deployment details should be checked
after merge to confirm the package settings were applied to both admin web and
worker services.

### Datadog observability

`src/instrumentation.ts` configures `dd-trace` for the Node runtime and enables
Datadog's built-in `graphql` plugin. This plugin automatically traces
`graphql.parse`, `graphql.validate`, `graphql.execute`, and `graphql.resolve`
spans, including Yoga's GraphQL executor path. Keep query source and variables
disabled in `src/observability/datadog.ts`; do not tag raw GraphQL documents,
variables, slugs, bearer keys, cookies, IPs, or user identifiers.

`src/components/DatadogRum.tsx` initializes Browser RUM for Admin when
`NEXT_PUBLIC_DATADOG_APPLICATION_ID` and `NEXT_PUBLIC_DATADOG_CLIENT_TOKEN` are
configured. The RUM service is `forge-admin`, matching backend APM for trace
correlation. RUM traces only Admin GraphQL URLs and uses masked-input privacy.

`src/observability/datadog-logs.ts` forwards server console logs to the shared
Datadog Agent over syslog UDP when `DD_AGENT_HOST` is configured. It preserves
normal Railway stdout, adds Datadog service/env/version fields, and attaches
active trace/span ids when `dd-trace` has an active span. Keep this transport
plain and opt-in; Railway does not let the Agent scrape sibling service stdout.

The shared Railway Datadog Agent service definition lives in
`infra/datadog-agent/`; operator setup and env variables are documented in
`docs/observability/datadog.md`. Admin browser sourcemaps upload with
`pnpm --filter @forge/admin datadog:sourcemaps`.

Production Admin Railway config lives in `apps/admin/railway.toml` once the
service's Config-as-code Path is set to that file. For best Datadog
auto-instrumentation, production must set Datadog service env
(`DD_SERVICE=forge-admin`, `DD_ENV=prod`, `DD_VERSION=<git sha>`), point
at the private Datadog Agent (`DD_AGENT_HOST`, `DD_TRACE_AGENT_PORT=8126`,
`DD_AGENT_SYSLOG_PORT=514`), and load the tracer before application modules through the `startCommand`:
`NODE_OPTIONS='--require dd-trace/init' node ...server.js`. Do not set
`NODE_OPTIONS` as a global Railway service variable because it is also present
during Railpack/mise build setup.

Use `pnpm --filter @forge/admin restore:video-db -- --target-env=development --in=<dump>`
to restore into local or staging Postgres. The restore path reads
`TARGET_DATABASE_URL` first, then `DATABASE_URL`, truncates only the reviewed
video manifest tables, and refuses `--target-env=production` unless
`--allow-production-target` is also present.

For local/staging self-service, prefer the presigned latest-backup path:

```bash
TARGET_DATABASE_URL='postgresql://forge:forge@db:5432/forge_admin' \
BACKUP_DOWNLOAD_API_KEY='<dev-or-stg-token>' \
pnpm --filter @forge/admin restore:video-db:latest -- --target-env=development
```

`restore:video-db:latest` calls production admin's
`POST /api/internal/video-db-backups/presign` endpoint when
`BACKUP_DOWNLOAD_API_KEY` is present. Production admin validates the bearer
against `BACKUP_DOWNLOAD_API_KEYS`, finds the latest `.dump` under
`admin-video-db-backups/<profile>/`, returns a short-lived GET-only signed URL,
and keeps raw `RAILWAY_S3_*` credentials inside the production runtime. The
endpoint requires production admin to have the normal `RAILWAY_S3_*` bucket env
vars configured; dev/staging should not need those S3 credentials.

### Search trace retention and sampling

Admin is the live search authority. REST `/api/search`, GraphQL `Query.search`,
query embedding generation, pgvector retrieval, production trace storage,
rollups, and retention all stay inside `apps/admin`. Mastra must not enter the
live request path and must not import Admin code or read Admin Postgres for eval
sampling; later eval jobs use Admin's internal HTTP contract only.

Production search tracing writes two records:

- `search_trace`: short-lived raw rows with query text after first-pass
  privacy classification/redaction, locale, route source, requested mode,
  response search mode, result count, latency bucket, outcome, trace class,
  deterministic quality/sensitive/abuse labels, rule label source/version/time,
  optional offline LLM labels/provenance, sample eligibility, and timestamps.
  Raw rows expire after `SEARCH_TRACE_RAW_RETENTION_DAYS` (default 29, max 29)
  so the daily purge deletes them before the hard 30-day ceiling.
- `search_trace_aggregate`: long-lived rollups by non-query dimensions. This
  table never stores query text or LLM prompts/results and is the durable
  analytical trail after raw rows are purged. It includes rule label
  source/version dimensions so future rule changes do not mix incompatible
  cohorts.

Trace writes are bounded best-effort. `recordSearchTraceSafely` is awaited
behind a short timeout and every write/timeout failure is swallowed from the
live search caller's perspective. Failures increment safe process-local
counters and log `[search] event=trace_record_* ...` without raw query text.

The internal sampling route is
`POST /api/internal/search-traces/sample`. It is rate-limited before auth/body
parsing, requires a bearer from `SEARCH_TRACE_SAMPLING_API_KEYS`, and defaults
to recent unexpired valid-viewer-intent rows with no sensitivity or abuse
labels. Broader sampling must explicitly request allowlisted quality,
sensitivity, abuse, or LLM-classification filters. The bearer CSV is optional
at boot and is part of the env disjointness invariant; it must not share values
with workflow, web/consumer, backup, manager, or Mastra ingest credentials.
Sample responses include `rawExpiresAt` so offline consumers can carry the
same retention boundary forward without receiving extra raw trace data.

Admin exposes narrow Admin-owned search-eval contracts for Mastra:

- `POST /api/internal/search-eval/catalog-context` returns compact published
  video/experience anchors plus fixed search-eval locale profiles. It deliberately omits
  embeddings, raw transcripts, auth data, scorer payloads, and edit-only
  fields.
- `POST /api/internal/search-eval/candidates` stores generated candidates in
  `search_eval_candidate` with source, locale, label provenance, generation
  model/provider, source anchors, expected-result hints, advisory judge
  summary, Mastra run id, and promotion status. Client-supplied promotion
  status is rejected.
- `GET /api/internal/search-eval/candidates` returns bounded staged candidate
  rows for offline eval reports. Trace-derived candidates are excluded at read
  time after their raw retention expiry.
- `POST /api/internal/search-eval/search` calls Admin's live search service for
  offline eval execution without writing production search traces. It keeps the
  public search response shape but remains an internal authenticated contract.

These routes use the same dedicated search trace/eval bearer allowlist. They
exist for offline eval generation only; neither route participates in live
request handling, live query embedding ownership changes, or public search
response shape changes.

Query labeling model:

- `queryQualityLabel`: `valid_viewer_intent`, `empty_too_short`,
  `navigational`, `catalog_lookup`, `malformed`, or `unknown_ambiguous`.
- `abuseLabel`: `none`, `repeated_spam`, `abusive`, or
  `prompt_injection_like`.
- `sensitiveQueryLabel`: privacy/redaction label (`none`, `email`, `phone`,
  `credential`, `token`, `cookie`, `ip`, `user_identifier`, or `mixed`).

The optional OpenRouter classifier lives at
`src/services/search-trace-query-classifier.ts` and is for ambiguous or
high-impact samples only. REST `/api/search` and GraphQL `Query.search` must
not call it, must not route through Mastra, and must not use labels to censor
or alter live results.

The Admin worker starts `src/workflows/searchTraceRetention.ts` when
`WORKFLOW_RUNNER_ENABLED=true` and
`WORKFLOW_TARGET_WORLD=@workflow/world-postgres`. The scheduler runs one purge
immediately, then daily at 10:00 UTC. `/api/search/health` reports retention
health and trace capture counters; in production, raw trace capture is disabled
when the retention scheduler or recent purge heartbeat cannot be confirmed.
The purge also removes trace-derived generated eval candidates whose
`retentionExpiresAt` has passed while they remain `generated`, keeping
unpromoted trace candidates inside the raw trace retention window.

Never add bearer tokens, cookies, IP addresses, full user identifiers,
caller-supplied key ids, vectors, debug scoring payloads, or raw query text to
aggregate rows or workflow details.

### Jesus Film Auth client mode

For local development, admin points at production Auth so engineers do not need
to run `apps/auth` locally:

```bash
AUTH_ISSUER_URL=https://auth.jesusfilm.org/api/auth
AUTH_ADMIN_CLIENT_ID=jfp_admin_local
ADMIN_BASE_URL=http://localhost:3003
```

Admin uses authorization code + PKCE and stores only admin-local session state
after callback. The callback route verifies issuer, audience, expiry, and the
`admin:access` scope before mapping Auth scopes onto admin's existing
VIEWER/EDITOR role ladder.

## Deployment

Railway service `@forge/admin` in project `forge` (Doppler project
`forge-admin` of the same name). Set the service's Config-as-code Path to
`apps/admin/railway.toml`; otherwise Railway ignores the per-service file and
the dashboard remains canonical.

**Authoritative configuration:**

| Field                      | Value                                                                                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Config-as-code Path        | `apps/admin/railway.toml`                                                                                                                                 |
| Start Command              | `HOSTNAME=0.0.0.0 NODE_OPTIONS='--require dd-trace/init' node apps/admin/.next/standalone/apps/admin/server.js`                                           |
| Custom Build Command       | `pnpm install --frozen-lockfile && pnpm --filter @forge/admin build && cp -r apps/admin/.next/static apps/admin/.next/standalone/apps/admin/.next/static` |
| Custom Pre-Deploy Command  | `pnpm --filter @forge/admin db:migrate:deploy`                                                                                                            |
| Healthcheck Path           | `/api/health`                                                                                                                                             |
| Healthcheck Timeout        | 60s                                                                                                                                                       |
| Restart Policy Max Retries | 3                                                                                                                                                         |

The `preDeployCommand` runs Prisma migrations before the standalone Next.js
server boots. If `migrate deploy` fails, the deploy is marked failed before
serving traffic (see Migrations section for failure-mode recovery). Other
deployment caveats in
`docs/solutions/deployment/nextjs-pnpm-monorepo-railway-standalone.md`
still apply: set `HOSTNAME=0.0.0.0` in the Railway dashboard (not
`[deploy.env]`).

**Editing dashboard config via MCP:** always pair
`mcp__railway__updateServiceTool` with
`mcp__railway__accept-deploy(environmentId)` — the update tool stages
patches into a buffer and a follow-up `redeploy` will snapshot the
unchanged canonical config. See
`docs/solutions/platform/railway-mcp-staged-config-never-commits-20260420.md`.

## Migrations

**Source of truth:** Prisma migrations in `apps/admin/prisma/migrations/`.
Future schema changes append new migration files — never rewrite
`0001_init`. Migrations apply in order at every container boot via
the chained `startCommand`.

**Forward-only.** `prisma migrate deploy` is the only correct
invocation against a deployed environment. NEVER run `prisma migrate
dev` against prod or any deployed env.

Migration `0014_drop_experience_locale_cms_snapshot` (2026-05-17) is
the first admin migration to drop columns — it removed the retired
`cms_document_id`, `cms_dumped_at`, `cms_content_hash` columns + the
partial index on `experience_locale`. Code-side rollback rules:

- Rolling back to the **immediately-prior commit** on the PR that
  added 0014 is functionally safe: that commit no longer references
  the dropped columns. Schema and code were co-versioned in the same
  PR.
- Rolling back further than that — to a commit that still references
  the dropped columns — is unsafe. The columns are gone from the DB
  but the code expects them, so Prisma reads fail at runtime. If you
  need to roll back past 0014, coordinate a re-add migration first.
- Every earlier migration (0001–0013) is purely additive — new
  tables, new columns, new indexes — so the pre-0014 rule that
  "rolling back to an earlier image is functionally safe" still
  holds for that stretch of history.

### Operational runbook — predeploy migration verification

After every deploy of `@forge/admin`, verify migrations actually
applied. The `apps/admin/railway.toml` shadow-override trap silently
skipped migrations across 5 PRs in late April 2026; verification is
mandatory until config-as-code is wired up.

**Smoke probe (run from your workstation):**

```bash
railway run pnpm --filter @forge/admin exec prisma migrate status
```

Expected healthy output: every migration in `apps/admin/prisma/migrations/`
listed as `Applied`, no `Pending` or `Following migrations have not
yet been applied` lines.

**Deploy-log probe (alternative):** grep the deploy log for
`Applying migration` lines and `All migrations have been
successfully applied`. Absence on a deploy that introduces a new
migration is a red flag — same shape as the 2026-04-29 incident.

### Failure-mode recovery

| Prisma error                                             | Cause                                                           | Recovery                                                                                                                                                         |
| -------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P3009** (`Migration … was rolled back, please review`) | A previous migration apply was interrupted or partially failed. | Fix the root cause (DB connectivity, privilege, etc.). Then `railway run pnpm --filter @forge/admin exec prisma migrate resolve --rolled-back <name>`. Redeploy. |
| **P3018** (`Migration cannot be applied cleanly`)        | Logical error in the migration SQL.                             | Fix the migration in a follow-up PR. Do NOT use `--applied` to fake-resolve a real failure.                                                                      |
| `permission denied for extension <name>`                 | Prod DB role lacks `CREATE` on the database.                    | Out-of-band: platform team grants `CREATE` on the role (or installs the extension directly). Redeploy.                                                           |
| `DATABASE_URL` absent / network egress fail              | Env var missing, or DB service unreachable.                     | Operator confirms env in dashboard / Doppler; verify DB service `online`. Redeploy.                                                                              |

**Manual fallback (emergency only):** if a deploy fails on
`migrate deploy` and you need to apply migrations out-of-band:

```bash
railway run pnpm --filter @forge/admin db:migrate:deploy
```

This runs the same command the chained `startCommand` would, against
the same env, without triggering a redeploy. Use sparingly — every
production migration should ideally land via a normal deploy so the
deploy log carries the audit trail.

**Key cross-references:**

- `docs/solutions/deployment/railway-dashboard-override-shadows-railway-toml-20260429.md` — the override-shadows-toml trap that this runbook exists to prevent recurrence of.
- `docs/solutions/platform/railway-mcp-staged-config-never-commits-20260420.md` — staged-patch flush requirement when editing dashboard via MCP.
- `docs/solutions/database-issues/prisma-unsupported-placeholder-for-raw-sql-generated-columns-20260429.md` — schema.prisma placeholders for raw-SQL-managed columns.
- `docs/solutions/database-issues/postgres-generated-column-drift-add-column-if-not-exists-20260429.md` — generated-column drift trap on Postgres.
- `docs/plans/2026-04-29-004-fix-admin-prod-migration-recovery-plan.md` — the recovery plan + the diagnostic walkthrough.

## Unit 4 — data model highlights

- **Experience + ExperienceLocale** with per-locale rows (independent
  publish state, unique `(locale, slug)` where `status = 'published'`).
  **`embedding` lives on `ExperienceLocale`, not on `Experience`** — search
  semantics match the user's language without leaning on multilingual-
  embedding-model approximation. `embedding` is NULL until the
  experienceEmbedding workflow runs against that locale's text. HNSW
  partial index excludes NULLs. `embedding` is NEVER exposed via GraphQL
  (technical control in `src/graphql/types/experience.ts` — field list
  omits it on both types; `src/graphql/schema.test.ts` asserts no
  `embed|vector|similarit` field leaks anywhere).
- **Video + VideoLocale + VideoDub + VideoDubDownload** with Core
  provenance (`coreId`, `source` enum, `syncedAt` — and `updatedAt`
  carries Core's authoritative timestamp on sync writes; see below).
  Source-authoritative contract: `source='manager'` rows are never
  overwritten by Core sync. `lengthInMilliseconds` is `BigInt` (int4
  truncates at 596 hours) and exposed as a string in GraphQL to preserve
  precision.
- **`VideoDub` is the rename of Core's `video-variant`.** The varying
  axis is the audio language (a dub of the parent Edition's frames),
  not the frames themselves. Boundary translation (`coreVariant → dub`)
  lives in the Core-sync transform layer (Unit 10), not at the DB.
  Quality tiers (mp4 480p, 720p, …) live in `VideoDubDownload`.
- **Core sync entity coverage is admin-native, not Strapi-shaped.** The
  approved Core projection lands in admin as:
  `Language` (+ audio preview columns), `Country`, `Continent`,
  `CountryLanguage`, `Keyword`, `Video`, `VideoLocale`, `VideoOrigin`,
  `VideoImage`, `VideoSubtitle`, `VideoStudyQuestion`, `BibleBook`,
  `BibleCitation`, `VideoKeyword`, `VideoRelation`, `VideoEdition`,
  `VideoDub`, `MuxVideo`, and `VideoDubDownload`. The old cms/Strapi sync is
  evidence for Core's fields only; admin code must continue reading Core
  directly and must not import from `apps/cms`.
- **Locale rule for Core data:** localized user-facing, retrieval-relevant, or
  UI-edited display content gets first-class rows so each locale can be
  addressed and audited independently. Videos use `VideoLocale` and
  `VideoStudyQuestion`; reference display names use `LanguageLocale`,
  `CountryLocale`, and `ContinentLocale`. Legacy JSON `name` maps remain only
  as compatibility mirrors during migration.
- **Coverage audit:** `runCoverageAudit()` in
  `src/services/core-sync/coverage-audit.ts` checks the approved entity and
  relationship classes after sync. `systemStatus` includes the latest audit
  result, and `runSync()` returns it for operator review before any consumer
  cutover or Strapi deletion work.
- **No `coreUpdatedAt` column on Core-sourced entities.** Sync writes
  Core's authoritative timestamp directly into the standard `updated_at`
  column by passing it explicitly: Prisma's `@updatedAt` only auto-fills
  when the value is omitted, so an explicit `updatedAt: coreData.updatedAt`
  in the upsert payload is respected. Local writes that don't pass
  `updatedAt` keep the auto-bump (right semantic for editor edits on
  `source='manager'` rows or future admin-authoritative entities).
  The upsert stale-write guard reads `updated_at` for ordering.
  `syncedAt` stays as the "when did admin last refresh this row"
  freshness signal.
- **`ContentRevision` is a generic, append-only revision log** covering
  the editor-mutable entity types: `ExperienceLocale`, `Experience`,
  `VideoLocale`, `Video`, `VideoDub`. One table for all of them so adding
  revision tracking to a new entity is a service-layer change, not a
  migration. Status enum: `DRAFT` (pending), `HISTORICAL` (snapshot at
  publish time), `DISCARDED` (abandoned). Partial unique index enforces
  at most one DRAFT per `(entity_type, entity_id)`. **60-day retention**
  via a Unit 11 useworkflow job (`DELETE WHERE revised_at < NOW() -
INTERVAL '60 days'`); index on `revised_at` makes pruning fast. Diffs
  computed on demand in resolvers — no pre-stored diff column.

  **Editor flow (PUBLISHED entities):**
  1. Editor opens published entity → reads canonical
  2. Edits → service creates or updates the entity's DRAFT revision
     (canonical untouched; in-flight changes can span days)
  3. Publish → service `$transaction`: snapshot canonical to HISTORICAL,
     apply DRAFT snapshot to canonical, delete DRAFT row

  **New content (no canonical yet):**
  - Service creates a stub canonical row with `status=DRAFT`
    (`LocaleStatus`) and minimum required fields filled with placeholders
  - Editor's actual content evolves in a DRAFT revision over the
    multi-day editing session
  - First publish: snapshot canonical (stub) to HISTORICAL, apply DRAFT
    to canonical, flip canonical status to PUBLISHED

  **Service-layer rule (wired in Unit 7):**
  - Any service-driven UPDATE on a covered entity creates / updates a
    revision in the same `$transaction`
  - First local edit on a `source='core'` row also flips `source` to
    `'manager'` so future Core sync skips it
  - Sync writes and workflow-derived column updates (e.g.,
    `ExperienceLocale.embedding`) skip revisioning
  - `revisedByKind`: `USER` | `AI` | `SYSTEM` (Prisma enum
    `RevisedByKind`)

  **Snapshot shape — write a versioned envelope, strip sensitive fields:**
  - Snapshots are stored as `{ v: 1, data: { ... } }` JSON. The version
    marker lets future schema migrations parse old snapshots leniently
    (`safeParse` with fallback) instead of failing rollback / diff views.
  - Service code MUST strip `embedding` (and any other derived /
    internal fields) from `data` before persisting. The embedding-
    exclusion test in `schema.test.ts` covers the GraphQL surface; the
    service layer must additionally never let an embedding vector land
    inside a revision snapshot.
  - Concurrent draft-create race: the partial unique
    `content_revision_one_draft_per_entity` enforces "one DRAFT per
    entity" at the DB level. The service must use `INSERT ... ON
CONFLICT` (Prisma `upsert`) or catch P2002 and retry as UPDATE,
    rather than letting the constraint violation surface raw.

  **Adding revisions to a new entity type (extensibility):**
  - No schema change. Pick the entity type string (e.g.
    `'experience_locale'`) and call the service-layer create/update
    helpers from any future service that mutates the entity.

  **Public reads** stay simple — read canonical filtered by
  `status=PUBLISHED`. Drafts never leak because they live in a separate
  table.

  **Approval workflow:** none in v1. Direct publish via existing
  `LocaleStatus` enum. Adds a `pending_review` status + reviewer
  assignment when the team actually asks for it.

- **`VideoSubtitle` attaches to `VideoEdition`, not to `Video`.**
  Timecodes derive from the edition's cut (a director's cut starts
  scenes at different timestamps than a theatrical cut), so subtitle
  alignment is an edition property. One unified entity covers all timed
  text tracks: source-language subtitle ≈ transcript, target-language
  subtitle = translation, same-language-as-dub subtitle ≈ closed
  caption. Semantics derive from `languageId` vs the dub's audio
  language at query time — no separate `Transcript` or `ClosedCaption`
  models.
- **Reference data** (Language, Country, Keyword, Continent,
  CountryLanguage, VideoOrigin, VideoEdition, MuxVideo, BibleBook) uses a
  single row with a `name` JSONB column keyed by locale — pragmatic for
  low-cardinality display-only localization.
- **Block schema** — Zod discriminated union in `src/domain/blocks.ts`
  with three scopes (top-level, section content, container-slot content)
  matching the 16 legacy CMS section components. `.strict()` rejects
  unknown keys; `quizButton` is scoped to `section.content`; section
  cannot contain another section. Adding a new block type is a single
  Zod schema + `t` literal + union entry — no Prisma migration required.
- **Pothos type classification** — every type carries
  `@classification abac-gated` or `@classification public-shape` JSDoc
  so Unit 6 can enforce the split-by-classification rule (abac-gated
  relations must route through a service resolver, not `t.relation`).

### Unit 3 spike — sign-off record (2026-04-13)

The architecture spike (Yoga + Pothos + Prisma plugin + scope-auth) was
verified against a live Postgres on 2026-04-13 and the go/no-go gate passed.

**Observed results against a seeded DB (2 Ping rows, 3 PingChild rows):**

- `{ pingAll { id message children { label } } }` with `x-spike-role: EDITOR`
  issued exactly two Prisma queries:
  1. `SELECT … FROM "public"."ping" ORDER BY "created_at" DESC`
  2. `SELECT … FROM "public"."ping_child" WHERE "ping_id" IN ($1,$2)`
     This is the batched IN-clause pattern the Pothos Prisma plugin uses for
     nested relations — no N+1.
- Unauthenticated `{ pingAll { id } }` rejected at the scope-auth layer
  before Prisma was invoked: `"Not authorized to resolve Query.pingAll"`.
- Unauthenticated `{ pingPublic(id: "p1") { ... } }` resolved to data for a
  Ping with `isPublic: true` (the `public: true` scope opts into anonymous
  access); the same query for `isPublic: false` returned `null` because the
  service's WHERE clause filtered it out.
- `fetchAPI: { Response }` streams correctly through Next App Router.

**Rerun the runbook (DB-dependent sign-off) any time the stack versions change:**

1. Start Postgres with pgvector extension available.
2. `pnpm --filter @forge/admin db:migrate:dev` — applies 0001_init + 0002_spike_ping.
3. Seed a Ping with ≥2 PingChild rows (Prisma Studio or psql).
4. Enable Prisma query logging (`NODE_ENV=development` already does this).
5. `pnpm --filter @forge/admin dev` and open `/api/graphql` in a browser.
6. Run this query with header `x-spike-role: EDITOR`:
   ```graphql
   query {
     pingAll {
       id
       message
       children {
         id
         label
       }
     }
   }
   ```
7. In server logs, count SQL statements: there should be at most TWO for
   the nested `children` resolution (one for the parent Ping, one JOINed
   or batched child lookup). Any higher count = Pothos `...query` is not
   being honored — STOP and re-evaluate before Unit 4.
8. Run the query WITHOUT the `x-spike-role` header: scope-auth must reject
   `pingAll` with an UNAUTHENTICATED-style error while `pingPublic(id)`
   still resolves for a Ping with `isPublic: true`.

Remove `Ping`/`PingChild` (schema + migration + graphql types + tests) in
the first Unit 4 commit after sign-off.

## Core sync — video-dubs phase

Admin owns the dub catalogue locally. The video-dubs sync phase
(`src/services/core-sync/phases/sync-dubs.ts`) writes Core's variants
into admin's `VideoDub` + `VideoDubDownload` + `VideoEdition` +
`MuxVideo` rows. Downstream embed enumeration (R1, R2) JOINs
`video_dub` to derive each video's dub-language set, so a partial dub
catalogue silently shrinks the embed target list — keep this phase
green.

- **Query shape:** flat top-level `videoVariants(offset, limit, input)`,
  not `videos { variants { … }}`. The nested form trips Core's resolver
  fan-out cliff on megavideos like JFP-Classic and aborts after ~50 s
  with `INTERNAL_SERVER_ERROR`. Both `since` (incremental) and full
  sync route through the same paginated loop; `since` populates
  `input: { updatedAt: { gte: since }}`, full passes `input: undefined`.
  See `docs/solutions/platform/core-graphql-unbounded-relation-fan-out-20260504.md`.
- **PAGE_SIZE = 100.** Inside Core's per-call cost ceiling for the
  flat query. Probe data: `videos(limit:5)+variants` ok in 240 ms,
  `videos(limit:25)+variants+downloads` times out at 50.4 s. The flat
  `videoVariants(limit:N)` shape spreads megavideo variants across
  pages, so 100 is comfortable today; raise it once Core lands a `take`
  cap on `Video.variants`.
- **Per-page error isolation.** The page loop wraps `coreQuery` in
  try/catch. A failing page logs `core-sync.video-dub.page.error` (with
  `offset`, `pageSize`, and `error.message`), increments `stats.errors`,
  advances `offset`, and continues. One transient Core hiccup mid-
  pagination must NOT abort the rest of the phase.
- **Soft-delete via array-bound raw SQL.** When `!since &&
stats.errors === 0 && seenCoreIds.size > 0`, the phase soft-deletes
  Core-sourced rows missing from the seen set via:
  ```
  UPDATE "video_dub"
  SET    "deleted_at" = NOW()
  WHERE  "source"     = 'core'
    AND  "deleted_at" IS NULL
    AND  NOT ("core_id" = ANY(${toPgArray([...seenCoreIds])}::text[]))
  ```
  Note: `'core'` is the lowercase DB enum value (`SourceTier ENUM('core',
  'manager')` from `0001_init`). Prisma's TS enum maps `CORE` → `'core'`
  automatically; raw SQL bypasses that mapping so the literal must match
  the DB value.
  NOT `prisma.videoDub.updateMany({ coreId: { notIn: [...] }})` — that
  generates one prepared-statement parameter per ID and Postgres caps
  prepared-statement params at 32,767 (`PG_INT16_MAX`). The 209k-row
  catalogue blew past the cap. The array-literal-as-text pattern keeps
  the parameter count at 1 regardless of catalogue size; per
  `apps/admin/src/db/pgvector.ts::toPgArray()` and the PG18 cast note
  in root `CLAUDE.md`.
- **Soft-delete safety:** the gating expression `!since && stats.errors
=== 0` means a partial seen-set (one or more page errors) NEVER
  triggers mass soft-delete. The phase silently records the in-flight
  errors and leaves Core-sourced rows alone for the next full sync to
  reconcile.

**Operational runbook:**

1. `pnpm --filter @forge/admin core-sync:run --full --scope=video-dubs`
   from a workstation with `DATABASE_URL` pointed at a target Postgres.
   Local destinations are safe; prod requires the usual operator
   discipline (`run-sync.ts` posture — there is no in-script prod-URL
   guard).
2. Expect ~30-40 min on a fresh DB at the current catalogue size; ~85%
   of wall time is variants of JFP-Classic-class megavideos. Per-page
   logging is silent on the happy path; failure events are JSON
   structured for easy filtering.
3. Re-run is idempotent and safe. Each re-run re-walks every page; row
   writes upsert-on-conflict; soft-delete is gated on zero page errors
   so a partial run never decimates the catalogue.

**Common pitfalls:**

- Re-introducing the nested `videos { variants { … }}` query shape
  (e.g., as a "we only need a few videos" optimisation). Don't — the
  same Core-side timeout will trip and a single megavideo in the
  batch aborts the whole call. Use the flat `videoVariants` query
  with a `where` filter on `videoId` if scoping is genuinely needed.
- Replacing the soft-delete `$executeRaw` with `prisma.videoDub
.updateMany({ coreId: { notIn: [...] }})` for stylistic reasons.
  Don't — the bind-variable cap re-asserts immediately. The test in
  `sync-dubs.test.ts` is a regression guard.
- Lowering `PAGE_SIZE` to "make it safer." It does not. The cost
  ceiling is set by Core's resolver, not by per-page network cost on
  our side. Use the diagnostic probe in
  `docs/solutions/platform/core-graphql-unbounded-relation-fan-out-20260504.md`
  to re-measure before changing the value.

## Scene embeddings (retired writer path)

Feat-193 retired the scene embedding writer pipeline. Do not reintroduce
Admin scene embedding backfills, `triggerSceneEmbeddingBackfill`, Mastra
`/forge-scene-embeddings`, `/api/internal/mastra/scene-embeddings`,
`MASTRA_SCENE_INGEST_API_KEYS`, `SCENE_EMBEDDING_CONCURRENCY`, or
`write:scene-embeddings`.

Historical `VideoScene` and `VideoSceneLocale` tables/rows remain in place
until the deferred retention/migration work is explicitly approved. This
cleanup only removes code paths that create, refresh, ingest, sync, or search
against scene embedding vectors.

Manager may still produce scene-analysis artifacts for non-search product
uses, and Admin may still read scene descriptions as non-vector context where a
current owner exists. Search, recommendations, and Experience AI semantic
candidate retrieval must stay transcript-backed; any remaining `video_scene`
or `video_scene_locale` read needs a non-search justification.

The old implementation notes live in historical plans/solution docs only as
archival context. They are not an operational runbook.

## Transcript embeddings (Mastra-owned generation)

Admin owns transcript vector storage, pgvector indexes, public search
contracts, and retrieval. Mastra owns transcript chunk planning and
embedding provider calls. Manager only produces transcript source data
(`{assetId}/transcript.json`: transcript text, timed segments, language,
provider metadata).

Mastra writes vectors through Admin's narrow internal ingest route:
`POST /api/internal/mastra/transcript-embeddings`. The route validates
`MASTRA_TRANSCRIPT_INGEST_API_KEYS`, accepts only transcript payloads,
guards `dimensions === 1536`, resolves Admin or external targets before
writing, and is idempotent by default. Explicit modes are `idempotent`,
`repair`, `force`, and `model-upgrade`.

- **Schema:** `VideoTranscript` attaches to `VideoEdition` (same cut-
  aware attachment as `VideoSubtitle` / `VideoScene`). One row per
  `(editionId, language)` carries artifact-level metadata (model,
  dimensions, chunking strategy, generatedAt, totalChunks, totalTokens).
  Per-chunk rows on `VideoTranscriptChunk` carry text + timecodes +
  `embedding Unsupported("vector(1536)")?`. `language` is denormalized
  onto the chunk for partial HNSW filtering.
  `embedding` is NEVER exposed via GraphQL (enforced by
  `schema.test.ts` "no embed/vector/similarit" assertion; client
  extension in `src/db/client.ts` strips it from default result sets).
- **Partial HNSW indexes** per-language (`en`, `es`, `fr`) plus a
  global NULL-excluded fallback. Same rationale as R1.
- **Indexer service:** `src/services/transcript-embedding.service.ts`
  (`writeTranscriptEmbeddingPayload` / `indexEditionTranscript`).
  Idempotent upsert on `(editionId, language)` for the parent and
  `(transcriptId, chunkIndex)` for chunks. Pre-transaction prune removes
  stale chunks when Mastra re-chunks with fewer segments. Raw SQL
  `::vector` write inside a Prisma `$transaction` with explicit 30s
  timeout. ABAC-gated via `canWriteDerived`.
- **Internal ingest service:**
  `src/services/transcript-embedding-ingest.service.ts`. Validates the
  Mastra payload, computes and checks a source-content hash, rejects
  ambiguous Manager-originated targets before writing, stores provenance
  (`sourceArtifactKey`, `sourceContentHash`, provider, Mastra run id,
  generation mode, chunking version), and delegates the actual table
  write to the existing indexer service.
- **Backfill workflow:**
  `src/workflows/transcriptEmbeddingBackfill.ts` — useworkflow job
  that enumerates one target per `(video, edition, bcp47)` triple.
  The language set is data-derived at enumeration time from the
  union of each video's primary language + edition-level subtitle
  languages + edition-level dub languages. No hardcoded language
  list, no `en` fallback — if a video has no language attestation
  anywhere, it produces no targets (a data-quality signal, not a
  silent default). Per-target error isolation; `artifact_missing`
  → skipped, every other error → failed but the run continues.
  Safe to re-run at the storage identity level. The workflow first groups
  enumerated targets by `(video, edition)` for stable reporting and source
  gap aggregation, then shards each `(video, edition, language)` target into
  target-bounded batches so no single Workflow step owns the full
  all-language corpus.
- **Bounded parallelism (Stage 2 — feat-116, updated for feat-192 hotfix):**
  the workflow calls `stepProcessTranscriptEmbeddingGroups` sequentially per
  target-bounded batch. Parallelism stays inside each batch via
  `TRANSCRIPT_EMBEDDING_CONCURRENCY`; do not use parallel dynamic workflow
  step fanout. The default step target limit is 50, each durable step stops
  launching new work after a 220s budget and returns remaining groups for the
  next step, and each Mastra launch has a 120s Admin-side timeout. The start
  log includes `groupBatchCount`, `stepTargetLimit`, `stepMaxDurationMs`, and
  `launchTimeoutMs` for production verification. Runtime knobs are resolved in
  a step before batching so workflow replay keeps the same partitioning even if
  Railway env changes mid-run.
- **Manager transcript fallback tradeoff:** target sharding means Manager
  fallback artifacts may be read once per durable step per `cmsVideoId`, not
  once for the whole run. The step-local source loader caches artifact reads
  while that batch is active, but later batches may reread the same Manager
  artifact. That is intentional for all-language backfills: bounded step
  duration is more important than whole-run S3 memoization until a first-class
  backfill ledger exists.
- **Timed-out Mastra launch confirmation:** if Admin receives a retryable
  Mastra launch network error that still has a `mastraRunId`, the batch step
  returns a pending confirmation. The workflow checks pending confirmations
  opportunistically between launch batches, then drains any remaining pending
  runs through short `stepConfirmTranscriptEmbeddingIngests` calls separated by
  workflow-level `sleep()`. Unresolved confirmations are marked failed only
  after the 20 minute confirmation window. Do not sleep inside the worker step.
- Tune via the `TRANSCRIPT_EMBEDDING_CONCURRENCY` env var. Admin
  backfill is now network-bound on Mastra plus DB-bound inside the
  ingest callback; default `5` leaves headroom on admin's
  `connection_limit=10` pool. Per-target progress streams via
  `transcript_index_complete` / `_skipped` / `_failed` log events and
  a single `event=start` carrying resolved concurrency and `groupCount`.
- **Trigger:** `triggerTranscriptEmbeddingBackfill` GraphQL mutation
  (ADMIN-only; permission key `write:transcript-embeddings`). Optional
  `mode` maps to Admin ingest's rewrite modes. Omitted mode defaults to
  idempotent.
- **NoSuchKey classification + missingArtifacts list (feat-119 PR1):**
  identical contract to R1 (see above). The R2 report's
  `missingArtifacts` entries stamp `kind: "transcript"` so PR2's
  `triggerManagerEnrichment` dispatches the transcript pipeline (vs
  scene-analysis). See
  `docs/solutions/runtime-errors/aws-s3-nosuchkey-classification-pattern-20260506.md`.
- **Bulk SQL writes (Stage 3 — feat-117):** the per-chunk
  `videoTranscriptChunk.upsert()` + per-row `$executeRaw … UPDATE …
embedding` loop collapses to ONE `INSERT INTO video_transcript_chunk
… SELECT * FROM unnest(12 parallel arrays) ON CONFLICT (transcript_id,
chunk_index) DO UPDATE SET …`. The 12 parallel arrays are: `id`,
  `transcript_id`, `language`, `chunk_index`, `chunk_id`, `text`,
  `token_count`, `start_seconds` (nullable), `end_seconds` (nullable),
  `model`, `dimensions`, `embedding_text`. Each is bound as a single
  `text[]` literal via `toPgArray`; per-row casts at the SELECT seam
  recover the int / double precision / vector(1536) types. Way A vector
  cast is `u.embedding_text::vector(1536)` — NOT `::vector(1536)[]` on
  the parameter (the array-input parser is less-trodden code). Length-
  equality preflight asserts ALL parallel arrays match
  `artifact.chunks.length` BEFORE invoking `$executeRaw` (PG18 silently
  NULL-pads unequal-length unnest args). The parent
  `videoTranscript.upsert(...)` stays as a Prisma call (one row per
  target — bulk-INSERT shape would not save a round-trip and would
  complicate the Prisma type story). See
  `docs/solutions/database-issues/pgvector-bulk-insert-on-conflict-pattern-20260505.md`.
  This bulk writer remains the single storage path for Mastra-ingested
  transcript vectors.

**Operational runbook** (shares the R1 mapping snapshot):

1. Refresh the coreId → cms video id mapping into admin's own Railway
   S3 bucket (the one wired to `RAILWAY_S3_*`):
   `pnpm --filter @forge/admin refresh:core-id-mapping`.
   Same CLI R1 uses; same snapshot consumed by both workflows.
2. Configure `RAILWAY_S3_*` (admin's own write bucket, used by the
   refresh CLI for `admin-migrations/core-id-mapping.json`),
   `MANAGER_ARTIFACTS_S3_*` (manager's bucket, where admin reads
   `{assetId}/transcript.json` and `{assetId}/scene-analysis.json`),
   `MASTRA_BASE_URL`, `MASTRA_SERVICE_API_KEY`,
   `MASTRA_TRANSCRIPT_INGEST_API_KEYS`, and `REDIS_*` on
   `forge-admin`. Mastra must also have
   `ADMIN_TRANSCRIPT_INGEST_URL`,
   `ADMIN_MASTRA_TRANSCRIPT_INGEST_API_KEY`, and its embedding provider
   key configured.
3. Invoke `triggerTranscriptEmbeddingBackfill` via GraphQL.
   `mappingS3Key` defaults to `admin-migrations/core-id-mapping.json`.
   Omitted `languages` means "every BCP-47 that exists across the
   corpus" (union of primary / subtitle / dub languages per edition).
   Restrict with `coreIds` (filter by video) or `languages` (strict
   inclusion list — no silent fallback). Today Manager writes one
   transcript source artifact per asset and Mastra embeds it per target,
   so multi-language editions produce multiple transcript rows from the
   same source text when the asset has multiple language attestations;
   the schema remains future-ready for per-language transcript artifacts.
   Use `mode` / `--transcript-mode` only for intentional repair or
   rewrite operations.
4. Verify:
   `SELECT COUNT(*) FROM video_transcript_chunk WHERE embedding IS NOT NULL`
   grows as expected;
   `SELECT DISTINCT video_edition_id FROM video_transcript`
   enumerates the indexed editions.

The current learnings doc is
`docs/solutions/platform/mastra-transcript-embedding-workflow-pattern.md`.
Historical vector-reuse context remains in
`docs/solutions/platform/admin-transcript-embeddings-vector-reuse-pattern.md`.

## Triggering experience embeddings (admin-native)

Experiences are authored, published, and rendered admin-native;
hybrid search needs `ExperienceLocale.embedding` populated to retrieve
over them. Three entry points cover the lifecycle.

The previous R3 cms → admin "experience content dump" workflow was
retired on 2026-05-17 (see
`docs/plans/2026-05-17-001-refactor-decouple-experience-embeds-from-cms-plan.md`).
cms is being deleted; no cms-coupled code, env var, or DB column
remains on the admin side of this surface.

### Per-locale trigger (one ExperienceLocale at a time)

`triggerExperienceEmbedding(localeId: ID!)` at
`src/graphql/mutations/experience.ts`. Gated by `write:experiences`
(EDITOR+) — owners can re-embed their own content. Dispatches
`runExperienceEmbedding` via `start()` from `workflow/api` and
awaits the per-locale result. Used by the editor surface today.

### Publish-flow auto-dispatch

`ExperienceService.publishLocale` and `updateExperienceLocale` (when
status=PUBLISHED) dispatch `runExperienceEmbedding` inline at
`src/services/experience.service.ts:573`. Every successful publish/
update of a PUBLISHED locale refreshes its embedding automatically.
No operator action required.

### Bulk backfill (admin-native)

`triggerExperienceEmbeddingBackfill` at
`src/graphql/mutations/experience-embedding-backfill.ts`. ADMIN-only
via `write:experience-embeddings`; bearer-callable from CLIs via
`WORKFLOW_TRIGGER`. The workflow at
`src/workflows/experienceEmbeddingBackfill.ts` enumerates eligible
`ExperienceLocale` rows (status='published' AND embedding IS NULL by
default) and dispatches `runExperienceEmbedding` per locale.
Sequential `for…of` per-target; per-target error isolation. JSON
return shape:

```ts
{
  totalTargets: number
  experienceIdFilter: readonly string[] | null
  localeFilter: readonly string[] | null
  force: boolean
  outcomes: Array<
    | { status: "succeeded"; target; dimensions; model; durationMs }
    | { status: "failed";    target; reason; durationMs }
  >
  succeeded: number
  failed: number
}
```

**Filter args** (all optional inclusion predicates; omitted = "every
eligible row"):

- `experienceIds: [ID!]` — restrict to specific parent Experiences.
- `bcp47Locales: [String!]` — restrict to a BCP-47 set, e.g.
  `["en", "es"]`. Data-derived at enumeration time when omitted; no
  hardcoded list, no `en` fallback.
- `force: Boolean = false` — when true, include rows that already
  have a non-NULL embedding (re-embed them). Use for model upgrades
  or drift fixes.

**Operational runbook:**

1. Ensure Admin can launch Mastra and receive the callback:
   `MASTRA_BASE_URL`, `MASTRA_SERVICE_API_KEY`, and
   `MASTRA_EXPERIENCE_INGEST_API_KEYS` on `forge-admin`; Mastra needs
   `ADMIN_EXPERIENCE_INGEST_URL`, `ADMIN_MASTRA_EXPERIENCE_INGEST_API_KEY`,
   and an embedding provider key.
2. Invoke via GraphQL with an ADMIN session, or via bearer auth
   using a `WORKFLOW_API_KEYS` key:

   ```graphql
   mutation {
     triggerExperienceEmbeddingBackfill(
       experienceIds: ["…"]
       bcp47Locales: ["en"]
       force: false
     )
   }
   ```

   Or from a workstation against any `DATABASE_URL` (see
   "Running embeds locally" below):

   ```bash
   pnpm --filter @forge/admin run-embeds --pipeline=experience
   ```

3. Verify:
   - `SELECT COUNT(*) FROM experience_locale WHERE status='published'
AND embedding IS NOT NULL` grows as expected.
   - The `event=run-embeds.experience.complete` log line on stdout
     (CLI) or the JSON return value (GraphQL) reports
     `succeeded/failed` counts.

**Common things to remember:**

- The workflow body uses sequential `for…of`, NOT `Promise.all` —
  cf. `parallel-workflow-error-robustness-20260420.md`. Admin's
  experience corpus is small enough that sequential is fast enough;
  parallelism is a follow-up if needed.
- Every `start()` call site has a dispatch-level test (cf.
  `workflow-dispatch-test-mode-divergence-20260421.md`). The
  mutation→workflow dispatch lives in
  `src/graphql/mutations/experience-embedding-backfill.test.ts`;
  the workflow→`runExperienceEmbedding` dispatch lives in
  `src/workflows/experienceEmbeddingBackfill.test.ts`.
- Locale enumeration is data-derived from admin's own
  `experience_locale.locale` column; no hardcoded list, no `en`
  fallback (cf.
  `prototype-defaults-vs-data-derived-enumeration-20260422.md`).
- `force: true` is for model upgrades / drift fixes — every locale
  that survives the filter gets re-embedded. Costs ~$0.01 per
  locale at admin's catalogue size.

## Hybrid search (R4 of admin migration playbook)

Admin owns public hybrid search — semantic + keyword retrieval fused via
Reciprocal Rank Fusion — over the `Video`/`VideoLocale` transcript-backed video
semantic corpus and `Experience`/`ExperienceLocale` corpora. It originally
matched apps/cms `/api/search` + `/api/search/health` byte-for-byte (modulo
cuid-string ids) for the R8 cutover, then feat-192 moved video semantic
evidence to enriched transcript chunks while preserving the public response
shape.

- **Shared service:** `src/services/hybrid-search.service.ts`
  (`HybridSearchService`). One `search(params)` entry point called by
  both the REST handler and the GraphQL resolver. Constants verbatim
  from cms: `RRF_K = 60`, `OVERFETCH_FACTOR = 3`, `DEFAULT_LIMIT = 20`,
  `MAX_LIMIT = 50`.
- **Retrievers:** `src/services/hybrid-search-retrievers.ts` exports
  four functions. Each is a thin `$queryRaw` caller.
  - `searchVideoSemantic` — pgvector cosine over enriched
    `VideoTranscriptChunk.embedding`, language-filtered and provenance-gated
    to the accepted gateway transcript contract, inside the existing
    `semantic-video` retriever. It collapses transcript chunks to one
    candidate per video before RRF and lets the winning chunk own
    `snippet`/`startSeconds`/`embeddingText`. Resolves
    `playbackId` via a LATERAL lookup on `video_dub → mux_video` keyed
    by `(video_edition_id, language.bcp47 = locale)`. When no dub
    matches, playbackId is NULL and the row still returns.
  - `searchVideoKeyword` — tsvector over `VideoLocale.title +
description`, same `'simple'` config as cms, locale + status gate.
  - `searchExperienceSemantic` — pgvector cosine over
    `ExperienceLocale.embedding` joined to non-archived Experience.
    `resultId` is `ExperienceLocale.id` (per-locale), not the parent
    Experience.id — admin's per-locale model makes the locale row the
    natural identity.
  - `searchExperienceKeyword` — tsvector over `ExperienceLocale.title
    - meta_description`.
- **GIN index byte-parity invariant:** the tsvector expressions live in
  `src/services/hybrid-search-sql.ts` as TypeScript string constants.
  The migration at `prisma/migrations/0006_hybrid_search_gin/migration.sql`
  uses the exact same expressions. A `hybrid-search-sql.test.ts` unit
  test reads the migration file and asserts byte-equality — silently
  drifting one but not the other reverts the query to Seq Scan.
- **Fusion + dedup:** `src/services/hybrid-search-fusion.ts` — RRF
  (`fuseRankedLists`) + 3-layer video dedup (`deduplicateResults`:
  coreId prefix, exact title, embedding cosine > 0.95) +
  `cosineSimilarityFromText`. Line-for-line port of cms's `fusion.ts`
  with `resultId: string` (admin cuids) instead of cms's integer ids.
  Experience rows skip all three dedup layers.
- **Transcript-backed evidence inside `semantic-video`.** Transcript chunks are
  NOT a fifth RRF list, and scene embeddings are no longer runtime search
  evidence. `VideoTranscriptChunk.embedding` feeds the single ranked video
  semantic list that flows into the existing RRF pipeline, preserving public
  REST/GraphQL response shape without double-counting legacy scene rows.
- **Video imageUrl resolves via LATERAL on `VideoImage`.** Both
  retrievers (semantic + keyword) emit
  `COALESCE(mobile_cinematic_high, url)` from the per-video
  `video_image` row, matching cms's `keyword-search.ts:54` /
  `semantic-search.ts:62` lookup. Earlier R4 doc claimed "imageUrl
  is null for video corpus (cms parity)" — that was a regression,
  not parity. cms's video retrievers DID populate `image_url` from
  `video_images.mobile_cinematic_high`; only the experience side
  defers the image join.
- **Experience imageUrl is null in R4.** cms parity (cms's
  experience retrievers also return null with comment "og_image
  join deferred"). `ExperienceLocale.ogImageUrl` exists on admin
  but wiring it is a deliberate post-cutover upgrade so the pre-R8
  diff-against-cms invariant holds for the experience corpus.
- **Degradation signal:** `searchMode: "hybrid" | "keyword-only"`. Set
  to `"keyword-only"` when the embedding provider throws. Structured
  log at error level: `[search] event=query_embedding_failure
error_class=… message=…`. Process-local counters in
  `src/services/hybrid-search-health.ts`.
- **Embedding provider:** reuses
  `generateExperienceEmbedding(text)` from
  `src/services/embeddings.service.ts` verbatim. Name is historical
  (it takes a plain string); renaming is a follow-up outside R4 scope.
- **REST endpoints** — Next App Router route handlers. First such
  endpoints in admin outside of `/api/auth` and `/api/graphql`.
  - `GET /api/search` at `src/app/api/search/route.ts` — query params
    `q` (required, trimmed), `locale` (required), `type` (optional
    enum), `limit`, `offset`. 400 on missing/invalid; 429 on
    rate-limit; 503 on unexpected service throw.
  - `GET /api/search/health` at `src/app/api/search/health/route.ts` —
    synthetic probe that runs a real `embedQuery("health probe")` with
    a 5s timeout. Always HTTP 200; body's `status` field is the
    machine-readable signal. Shared counters with the search
    orchestrator.
  - Rate limiting via `rateLimitAuthRoute` from `src/auth/rate-limit.ts`
    (same Redis-backed limiter used by `/api/auth`). Distinct `route`
    keys: `"search"` (30/min) and `"search-health"` (5/min) so probe
    traffic never starves the user quota.
- **GraphQL:** public `search(q, locale, type, limit, offset)` query
  at `src/graphql/queries/hybrid-search.ts`. `authScopes: { public: true }`.
  Returns `HybridSearchResponse` → `HybridSearchResult` with fields
  matching the REST JSON 1:1. `schema.test.ts` asserts the new types
  expose no `embedding|vector|similarit`-shaped field.
- **`embedding::text` transport in semantic-video SQL** is
  service-internal — it feeds the 3-layer dedup's cosine-similarity
  check. The Pothos schema never exposes it, so the GraphQL-surface
  leak guard in `schema.test.ts` still passes.

**Operational runbook:**

1. Point external monitors (Railway healthcheck, uptime tools) at
   `https://admin.jesusfilm.org/api/search/health`. Body's `status`
   field is the signal; HTTP is always 200 so infra-level liveness is
   not confused with provider reachability.
2. Ensure `OPENROUTER_API_PAID_KEY` is set on the `forge-admin` Railway
   service. `OPENROUTER_API_KEY` remains a fallback; `OPENAI_API_KEY` does not
   satisfy live query embedding readiness.
3. Canary diff vs cms: for a fixed query set × locales, compare
   `admin/api/search?q=…&locale=…` to `cms/api/search?q=…&locale=…`.
   Top-10 should overlap within ranking ±1. Drift signals transcript
   embedding readiness, provider-provenance mismatch, catalog publication
   visibility, or a current SQL-invariant drift to investigate.
4. Verify GIN indexes are used:
   `EXPLAIN ANALYZE SELECT COUNT(*) FROM video_locale WHERE
to_tsvector('simple', coalesce(title,'') || ' ' ||
coalesce(description,'')) @@ plainto_tsquery('simple', 'jesus');`
   should show `Bitmap Index Scan on video_locale_fulltext_search_idx`.

**Common things to remember:**

- R4 is a READ-SIDE port. No useworkflow dispatch, so no
  dispatch-level test obligation (cf.
  `workflow-dispatch-test-mode-divergence-20260421.md` — applies to
  backfill shapes, not synchronous reads).
- Every SQL invariant was re-derived from admin's schema (cf.
  `dead-invariant-checks-from-sibling-port-20260422.md`): cms's
  `videos.title` → admin's `video_locale.title`, cms's
  `video_variants` publish chain → admin's `VideoLocale.status +
Video.deleted_at`, cms's scene_embeddings single-row → admin's
  VideoSceneLocale per-locale.
- Data-derived enumeration (cf.
  `prototype-defaults-vs-data-derived-enumeration-20260422.md`): no
  hardcoded locale list. `locale` is required at the boundary;
  zero-result responses on a locale with no corpus are legitimate
  data signals.

The primary learnings doc is
`docs/solutions/platform/admin-hybrid-search-r4-pattern.md`.

Note: the 3-layer video dedup + `cosineSimilarityFromText` live in
`src/services/video-dedup.ts` as of R5 so hybrid search and scene
recommendations consume one implementation. `deduplicateResults` below
is a thin `FusedResult`-typed wrapper.

## Hybrid search keyword-first mode (R4 extension)

Opt-in `mode="keyword-first"` argument on the same `HybridSearchService`
that R4 ships. Adds three lexical retrievers + a post-fusion semantic-
dilution cap + an origin-gated debug payload. Default behavior stays
byte-identical to R4 main when `mode` is unset / null / `""` / `"hybrid"`
/ unknown — locked in by `src/services/hybrid-search.regression.test.ts`.

This is an **extension of R4**, not a new R-stage. The cms-side
`feat-109` work (apps/cms PR #852) lives on cms during the R3 → R8
window; admin's surface matches the cms-side contract by R8 cutover.

- **Schema:** Migration `0009_keyword_first_lexical/migration.sql`
  originally provisioned `pg_trgm`, two STORED generated tsvector
  columns on `video_locale` (`title_tsv`, `description_tsv`), a
  weighted GIN index over `(setweight(title_tsv,'A') ||
setweight(description_tsv,'B'))`, and a trigram GIN index on
  `title gin_trgm_ops`. Migration
  `0010_camelcase_tsv_and_description_trigram` then DROP-CASCADEd
  the generated columns and recreated them with a CamelCase-split
  `regexp_replace` wrapper before `to_tsvector` (so `BibleProject`
  tokenizes as `bible` + `project`, not just `bibleproject`),
  recreated the weighted GIN index, and added a second trigram GIN
  index on `description gin_trgm_ops`. **As of 0010:** generated
  columns are owned by 0010, the title trigram index from 0009 is
  untouched, and there are now TWO trigram indexes
  (`video_locale_title_trgm_idx`, `video_locale_description_trgm_idx`).
  Generated columns + GIN indexes attach to `VideoLocale`, NOT
  `Video` (per-locale attachment per admin's data model). The legacy
  R4 `video_locale_fulltext_search_idx` from `0006` is untouched —
  hybrid mode keeps reading it via `searchVideoKeyword`, which is
  why hybrid mode stays byte-identical to R4 even after 0010
  changed the keyword-first tokenization. See
  `docs/plans/2026-05-02-001-fix-keyword-first-camelcase-recall-plan.md`.

- **Byte-parity invariant:** `WEIGHTED_TSV_INDEX_EXPR` /
  `WEIGHTED_TSV_QUERY_EXPR` / `TITLE_TSV_GENERATED_EXPR` /
  `DESCRIPTION_TSV_GENERATED_EXPR` in `src/services/hybrid-search-sql.ts`
  must stay byte-equal to the migration. `hybrid-search-sql.test.ts`
  reads the migration and asserts. The trigram path uses operator-class
  GIN (`gin_trgm_ops`) — no expression byte-parity guard needed; index
  selection happens via the `%>` operator. Per
  `docs/solutions/best-practices/gin-byte-parity-trigram-vs-expression-indexes-20260429.md`.

- **Generated-column drift trap:** Postgres has no `ALTER COLUMN ...
GENERATED` editor for stored expressions. Any future rewrite of
  `*_GENERATED_EXPR` requires a coordinated `DROP COLUMN ... CASCADE +
ADD COLUMN ... GENERATED ALWAYS AS (...)` migration. Per
  `docs/solutions/database-issues/postgres-generated-column-drift-add-column-if-not-exists-20260429.md`.

- **Three new lexical retrievers** in
  `src/services/hybrid-search-keyword-first-retrievers.ts`:
  - `searchByKeywordWeighted` — phrase-aware
    `websearch_to_tsquery('simple', q)`, ranked by `ts_rank_cd`
    against the weighted tsvector. `Prisma.raw(WEIGHTED_TSV_QUERY_EXPR)`
    for the unbindable expression fragment.
  - `searchByTrigram` — `vl.title %> q OR vl.description %> q`
    with ranking by
    `GREATEST(similarity(vl.title, q), similarity(coalesce(vl.description, ''), q))`.
    Per-row dedup via `DISTINCT ON (v.id)` collapses rows that match
    via both fields. Backed by `video_locale_title_trgm_idx` (from 0009) and `video_locale_description_trgm_idx` (from 0010). The
    description-side index is heavier than the title-side; current
    catalog is 0 rows in prod, so the precaution that gated R4 on
    title-only no longer applies — but capture
    `pg_relation_size('video_locale_description_trgm_idx')` once R0
    backfill lands and revisit if it grows beyond a few hundred MB.
  - `searchByExactTitle` — dynamic AND-chain of `vl.title ILIKE ?`
    via `Prisma.join`, ranked `LENGTH(title) ASC`. Tokenization is
    Unicode letter / digit split, lowercased, deduped, **capped at
    `MAX_EXACT_TITLE_TOKENS = 16`** (DoS guard from cms-side fix).
    All three honor R4's locale + status + `deleted_at IS NULL` chain.

- **Branched orchestrator:** Single `HybridSearchService.search()`
  branches once on `pipelineMode === "keyword-first"`. Hybrid path
  is UNTOUCHED. Keyword-first dispatches: semantic-video (shared) +
  keyword-weighted-video + trigram-video + exact-title-video. The
  R4 `searchVideoKeyword` is NOT called on the keyword-first branch.
  Per `docs/solutions/design-patterns/branched-orchestrator-opt-in-mode-pattern-20260429.md`.

- **Mode normalization:** `normalizeMode(raw, logger)` decodes the
  free-form public arg to a closed `SearchPipelineMode` set. Unknown
  values warn-and-fall-back to hybrid via a single sanitized log line
  (`[search] event=search_unknown_mode mode=… falling_back=hybrid`)
  — never throws. CR/LF/TAB stripped, length clamped to 64. Per
  `docs/solutions/security-issues/log-injection-sanitizer-user-input-structured-logs-20260429.md`.

- **Semantic-dilution cap:** Active only in keyword-first mode and
  only when at least one exact-title result's lowercased title
  contains every query token. When triggered, semantic-only fused
  results whose `videoCoreId` is null OR not present in the top-3
  keyword-side core_ids get `score *= 0.5` and the list re-sorts.
  `applyDilutionCap` is exported for unit testing. Gated by
  `SEARCH_DILUTION_CAP_ENABLED` (default `true`; only literal
  `"false"` disables — tolerant parser is a documented follow-up).

- **Origin-gated `debug` payload:** `isDebugAllowedForOrigin` in
  `src/services/hybrid-search-debug-allowlist.ts` is the soft gate.
  Boundary (REST + GraphQL) consults the allowlist; the service
  trusts the boolean. Fail-closed on `Origin: undefined`. Allowlist:
  `SEARCH_DEBUG_ALLOWED_ORIGINS` CSV; otherwise any origin in
  non-production. Threat model is "soft feature flag, not auth" —
  Origin headers are forgeable from non-browser clients. The payload
  carries no PII / credentials, only retriever ranks + fused score
  - cap state. Per
    `docs/solutions/security-issues/origin-header-soft-gate-not-security-boundary-20260429.md`.

- **GraphQL types:** `HybridSearchResult.debug` is a nullable
  `HybridSearchResultDebug` (`retrieverRanks`, `fusedScore`,
  `dilutionCapApplied`). `HybridSearchRetrieverRank.label` is
  explicitly **UNSTABLE** in the schema description — operators
  inspecting payloads are the audience; do NOT branch on those
  strings in production code. `schema.test.ts` asserts no
  `embed|vector|similarit` field leaks on either new type.

- **REST endpoint:** Same `GET /api/search` extends with `mode` +
  `debug` query params. `mode=` (empty) is forwarded as undefined to
  avoid polluting the warn log. `debug=true` is the only opt-in
  spelling — `debug=1` and other truthy values are treated as off
  (debug is a deliberate developer affordance, not a fuzzy toggle).

- **Endpoints + acceptance:**
  - `GET /api/search?q=…&locale=…&mode=keyword-first&debug=true`
  - GraphQL: `Query.search(q, locale, type?, limit?, offset?, mode?, debug?)`
  - Bible Project headline test
    (`src/services/hybrid-search.bible-project.test.ts`) asserts top-3
    are all `/bible\s*project/i` titles for `q="the bible project"`.

- **Test-first regression gate:**
  `src/services/hybrid-search.regression.test.ts` asserts byte-identity
  across `mode ∈ {undefined, null, "", "hybrid", "garbage"}` against
  deterministic mocked retrievers. Adding a new retriever / debug
  field / cap parameter is allowed only as long as that test stays
  green. Per
  `docs/solutions/best-practices/test-first-regression-snapshot-byte-identical-default-20260429.md`.

**Operational runbook:**

1. Apply migrations `0009_keyword_first_lexical` and
   `0010_camelcase_tsv_and_description_trigram` in any environment
   that wants keyword-first available. `prisma migrate dev` /
   `prisma migrate deploy` is idempotent against `_prisma_migrations`.
   **Re-applying 0010 manually against a populated `video_locale` is
   destructive** — DROP CASCADE removes the columns and the rebuild
   takes AccessExclusiveLock. Treat fixes as forward-only
   counter-migrations, never `migrate resolve --rolled-back` 0010
   once R0 has populated the table. The three GIN indexes
   (weighted, title trgm, description trgm) add disk + write
   amplification proportional to corpus size; cost is negligible at
   admin's current zero-row prod data and grows when R0 backfills.
2. Confirm `pg_trgm` extension permission on the prod DB role.
   First migration that needs it; older R0–R5 migrations don't.
3. To opt in via REST, append `?mode=keyword-first`. To opt in via
   GraphQL, pass `mode: "keyword-first"`. Default behavior is
   byte-identical to R4.
4. To inspect scoring on a dev / preview environment: append
   `&debug=true` AND make the request from an allowlisted origin
   (any origin in non-production by default; explicit
   `SEARCH_DEBUG_ALLOWED_ORIGINS` CSV overrides). Curl needs an
   explicit `-H "Origin: <allowlisted>"` header.
5. Verify GIN indexes are used. Probe SQL:
   `EXPLAIN ANALYZE SELECT v.id FROM video_locale vl JOIN video v ON
v.id = vl.video_id WHERE setweight(vl.title_tsv,'A') ||
setweight(vl.description_tsv,'B') @@
websearch_to_tsquery('simple', 'jesus') AND vl.locale = 'en'
LIMIT 10;`
   should show `Bitmap Index Scan on
video_locale_lexical_weighted_idx`. Trigram probe (post-0010, both
   title and description halves should appear in the plan via
   `BitmapOr`):
   `… WHERE (vl.title %> 'jesus' OR vl.description %> 'jesus') …`
   should show `BitmapOr` over `video_locale_title_trgm_idx` and
   `video_locale_description_trgm_idx`. On an empty corpus the
   planner correctly prefers Seq Scan; the BitmapOr plan only
   matters once data lands. Re-run this probe at R0 readiness.
6. R0 dependency: admin's `video` / `video_locale` tables are 0 rows
   in prod. Real-DB integration tests (canary diff vs cms keyword-first,
   EXPLAIN-based GIN verification) are deferred to R0 readiness.

**Common things to remember:**

- The hybrid path is byte-identical to R4. Touching it without
  updating `hybrid-search.regression.test.ts` is the definition of a
  regression. Per `docs/solutions/best-practices/dead-invariant-checks-from-sibling-port-20260422.md`.
- `searchMode` (response field) ≠ `mode` (input arg). The response
  reports embedding-degradation; the input selects the pipeline.
  GraphQL schema description on `Query.search.mode` explicitly
  disambiguates.
- Retriever labels in the debug payload are UNSTABLE — never branch
  on them in production code.
- `Prisma.raw(EXPR)` is reserved for the unbindable weighted tsvector
  fragment. Bound parameters interpolate via `${expr}` in the
  template literal. `searchByExactTitle` uses `Prisma.join` to
  compose the variable-length AND-chain so the placeholder count
  always matches the bound-value count (Postgres rejects unbound
  placeholders at parse time, which is the safe failure mode).
- The dilution cap is invisible on thematic queries
  (`q="hope when life is hard"`) — those have no exact-title trigger,
  so the cap silently does nothing. Hard filtering is intentionally
  NOT used.

The primary learnings doc is
`docs/solutions/platform/admin-hybrid-search-keyword-first-r4-extension-pattern.md`.

## Scene recommendations (R5 of admin migration playbook)

Admin owns public scene-similarity recommendations — given a seed video
(+ optional scene), return the top-N most-similar scenes from other
videos that have a playable dub in the requested locale. Matches the
contract of apps/cms `GET /api/scene-embedding/recommendations` and
`sceneRecommendations` GraphQL query byte-for-byte (modulo cuid-string
ids) so apps/web can swap base URL at R8 cutover with zero response-
shape drift.

- **Shared service:** `src/services/scene-recommendations.service.ts`
  (`SceneRecommendationsService`). One `getRecommendations(params)`
  entry point called by both the REST route and the GraphQL resolver.
  Constants ported from cms: `DEFAULT_LIMIT = 10`, `MAX_LIMIT = 50`,
  `OVERFETCH_FACTOR = 3`.
- **Retriever:** `src/services/scene-recommendations-retriever.ts`
  exports four `$queryRaw` helpers:
  - `resolveSlugToVideoId(slug)` — non-deleted `video.slug` → cuid.
  - `fetchInputEmbeddings(videoId, locale, sceneIndex?)` — per-chunk or
    per-video transcript input embeddings in the requested locale. The
    `sceneIndex` argument is a compatibility alias for transcript
    `chunk_index`.
  - `getRelatedVideoIds(videoId)` — self + parent + child via the
    `video_relation` table.
  - `queryScenesSimilar(queryEmbedding, locale, excludeIds, limit)` —
    DISTINCT ON over `video_transcript_chunk.embedding`, locale-filtered
    through the transcript parent/chunk language columns and the 3-hop
    `VideoDub(edition, language)` chain, with
    `v.deleted_at IS NULL + video_locale.status='published'` consumer
    visibility. Playback is resolved via LATERAL + **INNER JOIN** on
    dub/mux so rows without a resolvable playback are filtered out
    (preserves cms's non-null `playbackId` contract; distinct from hybrid
    search which uses LEFT JOIN).
- **Dedup:** 3-layer video dedup (coreId prefix, exact title, embedding
  cosine > 0.95) via the shared `dedupeByVideoIdentity` primitive in
  `src/services/video-dedup.ts`. Same primitive R4 hybrid-search uses.
- **Per-scene vs per-video modes.** Per-scene (sceneIndex provided OR
  seed has one scene) runs one similarity query with
  `limit * OVERFETCH_FACTOR` overfetch. Per-video (seed has multiple
  scenes) queries each scene, merges best-similarity-per-candidate,
  then dedups. Ported verbatim from cms's `getRecommendations`.
- **Identity delta from cms.** `videoId` on the response is a **cuid
  `ID!`** (not cms's `Int!`). apps/web's renderer uses it only as a
  React key, so the cutover is a one-line TypeScript-type update on
  `apps/web/src/lib/recommendations.ts::SceneRecommendation`. Documented
  in plan §Key Technical Decisions #2.
- **`imageUrl` is null in R5** (was claimed "cms parity inherited
  from R4" but R4 was itself a regression — see R4's "Video imageUrl"
  bullet above; cms's scene-recommendations DID populate `image_url`
  via VideoImage LATERAL). Wiring R5 to match the R4 LATERAL JOIN
  pattern is a parallel follow-up. Until then, scene-recommendation
  thumbnails depend on consumer-side fallbacks (Mux thumbnail from
  `playbackId`, gradient placeholder). Original note: wiring a real
  `imageUrl` from `VideoImage` / MuxVideo thumbnail is a
  post-cutover upgrade so the pre-R8 diff-against-cms invariant holds.
- **REST endpoint:** `GET /api/scene-embedding/recommendations`
  (singular) at `src/app/api/scene-embedding/recommendations/route.ts`.
  Query params: `videoId`, `slug`, `locale` (required),
  `sceneIndex?`, `limit?`. At least one of `videoId`/`slug` required.
  Response envelope: `{ recommendations: SceneRecommendation[] }`.
  Status codes: 400 validation, 404 `VideoNotFoundError`, 429 rate
  limit, 503 unexpected failure. Rate-limit bucket
  `"recommendations"` at 30/min (distinct from search's bucket so they
  don't starve each other).
- **GraphQL:** public `sceneRecommendations(videoId, slug, locale,
sceneIndex, limit): [SceneRecommendation!]!` query at
  `src/graphql/queries/scene-recommendations.ts`. `authScopes: {
public: true }`. `VideoNotFoundError` soft-swallowed to `[]` so the
  apps/web block renders an empty state (matches cms's resolver).
  `schema.test.ts` asserts the new `SceneRecommendation` type exposes
  no `embed|vector`-shaped field; `similarity` is allowed (cms parity).
- **Zod block variant:** `VideoRecommendationsBlockSchema` in
  `src/domain/blocks.ts` — forward-looking schema with no cms
  precedent. Top-level `BlockSchema` only, not valid inside
  `section.content`. Schema lands now; editor UX + renderer come later
  under tatai's feat-100/103.

**Operational runbook:**

1. Ensure transcript chunk embeddings are backfilled for the locales you care
   about (prod readiness): `SELECT COUNT(*) FROM video_transcript_chunk vtc
JOIN video_transcript vt ON vt.id = vtc.transcript_id
WHERE vtc.language = 'en'
  AND vtc.embedding IS NOT NULL
  AND vt.embedding_provider = 'jesus-film-ai-gateway'
  AND vt.model = 'embeddings'
  AND vt.dimensions = 1536
  AND vt.embedding_native_dimensions = 1536
  AND vt.embedding_transform_version IS NULL
  AND vtc.model = 'embeddings'
  AND vtc.dimensions = 1536;` should be non-zero before canary diffs.
2. Canary diff vs cms. For a fixed set of `(slug, locale)` seeds,
   compare `admin/api/scene-embedding/recommendations?slug=…&locale=…`
   to `cms/api/scene-embedding/recommendations?videoId=…&locale=…`.
   Top-10 should overlap within ±1 ranking position for seeds with
   published dubs in the requested locale. Divergence signals either a
   transcript data-readiness/provenance gap or an SQL-invariant drift to
   investigate.
3. Rate-limit monitoring. The `"recommendations"` Redis bucket is new.
   Add to dashboards alongside `"search"` / `"search-health"`.
4. Verify the transcript vector path with `EXPLAIN ANALYZE` over
   `video_transcript_chunk` joined to `video_transcript` using the same
   provider/model/dimension predicates as search and recommendation
   services. Do not diagnose recommendation readiness from scene-vector
   indexes; the compatibility endpoint is transcript-backed.

**Common things to remember:**

- R5 is a READ-SIDE port. No useworkflow dispatch, so no
  dispatch-level test obligation (cf.
  `workflow-dispatch-test-mode-divergence-20260421.md` — applies to
  backfill shapes, not synchronous reads).
- INNER JOIN on dub/mux is intentional and distinct from R4's LEFT
  JOIN. Rows without a playable dub in the requested locale are
  filtered out. If that tightens results vs cms beyond ±1 on the
  canary seeds, measure first — don't loosen the guarantee
  reactively; apps/web's renderer consumes `playbackId` as `String!`.
- The 3-layer dedup lives in `src/services/video-dedup.ts` now. Both
  R4 and R5 call `dedupeByVideoIdentity`. Editing the primitive
  affects both surfaces — update both test files (`video-dedup.test.ts`
  - `hybrid-search-fusion.test.ts`) when touching dedup behavior.
- `VideoRecommendationsBlockSchema` has no cms precedent and no
  renderer yet; it's schema-only until feat-100/103 gives it an
  authoring surface.

The primary learnings doc is
`docs/solutions/platform/admin-scene-recommendations-r5-pattern.md`.

## Running embeds locally (R1 + R2)

Local-dev workflow for populating a freshly-synced `forge_admin` DB
with scene + transcript embeddings — bypasses the GraphQL trigger
path and the Cloudflare 524 edge timeout. Per
`docs/plans/2026-04-29-006-feat-local-embed-pipeline-and-manager-trigger-plan.md`.

**Three-step runbook:**

1. **Pull the prod mapping snapshot to local fallback:**

   ```bash
   RAILWAY_S3_ACCESS_KEY_ID=... \
   RAILWAY_S3_SECRET_ACCESS_KEY=... \
   pnpm --filter @forge/admin pull:mapping
   ```

   Downloads `s3://cms-storage-jbpuckp0lmqap/admin-migrations/core-id-mapping.json`
   (admin's prod bucket — same key the GraphQL workflow reads in
   prod) into `apps/admin/.tmp/objects/admin-migrations/core-id-mapping.json`.
   Admin's `src/storage/s3.ts` `getObject` falls back to that path
   when `RAILWAY_S3_BUCKET` is unset, so the workflow reads it
   transparently at runtime.

2. **Configure manager-bucket creds + embedding workflow keys in
   `apps/admin/.env`:**

   ```
   MANAGER_ARTIFACTS_S3_ENDPOINT=...
   MANAGER_ARTIFACTS_S3_REGION=...
   MANAGER_ARTIFACTS_S3_BUCKET=...
   MANAGER_ARTIFACTS_S3_ACCESS_KEY_ID=...
   MANAGER_ARTIFACTS_S3_SECRET_ACCESS_KEY=...
   MASTRA_BASE_URL=...
   MASTRA_SERVICE_API_KEY=...
   MASTRA_TRANSCRIPT_INGEST_API_KEYS=...
   MASTRA_EXPERIENCE_INGEST_API_KEYS=...
   ```

   Pull these from Railway's `forge-admin` service env (read-only —
   manager bucket is read-only at the code layer).

3. **Run the pipeline:**

   ```bash
   DATABASE_URL='postgresql://forge:forge@db:5432/forge_admin' \
   pnpm --filter @forge/admin run-embeds --pipeline=transcript
   #   --pipeline=transcript|experience|both|all     (required)
   #   # both = transcript legacy alias; all = transcript + experience
   #   --core-id=<id>          (repeatable; restrict to specific videos)
   #   --locale=<bcp47>        (repeatable; experience filter)
   #   --language=<bcp47>      (repeatable; transcript filter)
   #   --transcript-mode=idempotent|repair|force|model-upgrade
   #   --experience-mode=idempotent|repair|force|model-upgrade
   #   --experience-id=<id>    (repeatable; experience filter)
   #   --gate-report=docs/search-eval-reports/<id>.json   (required for all)
   #   --mapping-key=admin-migrations/core-id-mapping.json   (default)
   ```

   Direct-invokes `runTranscriptEmbeddingBackfill` or
   `runExperienceEmbeddingBackfill`
   against the in-process Prisma singleton, mirroring `pnpm run-sync`.
   Per-pipeline error isolation; structured JSON output. Transcript and
   experience runs launch Mastra, which generates vectors and calls Admin
   ingest; Admin keeps vector storage and search retrieval authority.

   `--pipeline=all` is the AI Gateway content replacement path. It runs
   transcript and experience branches, and it refuses to start until
   `--gate-report` points at a sanitized
   `content-search-eval-gate-report` whose gate is backfill-ready, judged,
   calibrated, passed, has zero loss/search/judge/disagreement failures, and
   is bound to the Jesus Film AI Gateway `embeddings` provider with 1536 native
   dimensions, 1536 final dimensions, and `transformVersion: null` for the
   current production gateway contract. Local-only dry exercises can use
   `--allow-ungated-local-backfill` only when `DATABASE_URL` points at a
   loopback host and the database name contains `local`, `test`, `dev`, or
   `development`; production and tunneled prod databases cannot bypass the
   gate.

   Canonical AI Gateway replacement shape:

   ```bash
   DATABASE_URL='postgresql://forge:forge@db:5432/forge_admin' \
   pnpm --filter @forge/admin run-embeds \
     --pipeline=all \
     --transcript-mode=model-upgrade \
     --experience-mode=model-upgrade \
     --gate-report=docs/search-eval-reports/<id>.json \
     --report-out=.tmp/prod-embeds/content-ai-gateway-backfill.json
   ```

4. **Do not retry scene outcomes from prior reports:** `--pipeline=scene`,
   `--scene-mode`, and `--from-report` are retired with the scene embedding
   writer path. Historical scene embedding reports are archival; do not use
   them as an operational retry source.

**Local DB is the destination.** `DATABASE_URL` is the only safety
guard — there is no in-script check that detects a prod URL. Mirrors
`run-sync.ts`'s posture; operator discipline applies.

**Long-running invocations.** Full transcript/experience runs across the local
catalogue can take many minutes — the CLI blocks in-process. If you
need to walk away from the terminal, use `tmux` / `screen` / `nohup`
so a session disconnect doesn't kill the run mid-flight:

```bash
nohup pnpm --filter @forge/admin run-embeds --pipeline=both \
  > .tmp/run-embeds-$(date +%s).log 2>&1 &
```

The CLI is **safe to interrupt** — Ctrl-C / SIGTERM disconnects the
prisma client cleanly and exits with code 130. Workflow upserts are
idempotent, so re-running picks up where the last run left off. Do
NOT assume a run completed if your terminal closed mid-stream
without seeing the final `run-embeds.complete` event.

The new solutions doc
`docs/solutions/platform/local-embed-pipeline-pattern-20260429.md`
captures the architectural pattern (local-fallback storage trick,
direct-invoke shape, prod-mapping-pull rationale).

### Legacy OpenAI embedding cleanup

Use this only after confirming the target database and backup posture. The CLI
dry-runs by default and writes a JSON report under
`.tmp/legacy-openai-embedding-cleanup/` unless `--report-out` is provided.

```bash
DATABASE_URL='postgresql://forge:forge@db:5432/forge_admin' \
pnpm --filter @forge/admin cleanup:legacy-openai-embeddings -- \
  --target-env=development
```

The cleanup targets only known legacy OpenAI embeddings:
`openai/text-embedding-3-small`, `text-embedding-3-small`, or OpenAI provider
provenance where this schema stores it. It clears legacy scene and experience
vectors in place, deletes transcript chunks whose parent transcript uses the
legacy OpenAI model, and verifies or drops reverted `embedding_qwen`
columns/indexes if a target database still has them. It does not use
`chunking_version` as a selector and does not delete transcript parent rows,
Manager artifacts, S3 objects, source media, or source transcript artifacts.

Production execution is intentionally noisy and requires both an explicit
production unlock and backup evidence:

```bash
DATABASE_URL='<production-admin-db-url>' \
pnpm --filter @forge/admin cleanup:legacy-openai-embeddings -- \
  --target-env=production \
  --execute \
  --allow-production-target \
  --backup-evidence='<backup key or recovery point id>' \
  --report-out=.tmp/legacy-openai-embedding-cleanup/prod-cleanup.json
```

Run a production dry-run first, inspect the report for ambiguous rows or
blocked Qwen migration state, and only then execute. Re-embedding is a
separate `run-embeds` operation after cleanup.

## Triggering embeds from manager

Manager exposes a thin REST proxy that forwards to admin's active
transcript embedding GraphQL trigger mutation. Same workflow runs end-to-end
on admin's side -- manager owns presentation, admin owns execution. No
workflow duplication; data ownership stays with admin.

**Endpoints (manager-side):**

- `POST manager/api/admin-embeds/transcript` — body `{ mappingS3Key?,
coreIds?, languages? }`. Proxies to admin's
  `triggerTranscriptEmbeddingBackfill`.

The proxy gates manager-side via `authenticateRequest` (Strapi JWT cookie
or `MANAGER_API_KEY` bearer) before forwarding. The old
`POST manager/api/admin-embeds/scene` route and
`triggerSceneEmbeddingBackfill` mutation are retired.

**Admin-side auth posture (plan 006):** admin's GraphQL context
mints a request-bound `WORKFLOW_TRIGGER` principal when an incoming
request carries `Authorization: Bearer <key>` matching one of the
keys in `WORKFLOW_API_KEYS` (the same env var the workflow callback
endpoint validates with HMAC). The `WORKFLOW_TRIGGER` role
satisfies a narrow allowlist defined in `src/auth/permissions.ts`
(`WORKFLOW_TRIGGER_PERMISSIONS`) -- currently:

- `write:transcript-embeddings` — `triggerTranscriptEmbeddingBackfill`
- `write:experience-embeddings` — `triggerExperienceEmbeddingBackfill`
- `write:manager-enrichment-trigger` — `triggerManagerEnrichment` (feat-119 PR2)
- `read:video-metadata` — `videosByCoreIds` query (feat-125; manager's admin-trigger CMS-replacement lookup)

Adding mutations or queries to that allowlist widens the bearer
caller's blast radius; do so deliberately. See
`src/auth/workflow-bearer.ts`.

**Env (manager):** `ADMIN_GRAPHQL_URL` +
`ADMIN_EMBED_TRIGGER_API_KEY` on `forge-manager` Doppler. The key
must match an entry in admin's `WORKFLOW_API_KEYS` CSV.

## Triggering manager enrichment from admin (feat-119 PR2)

Inverse direction of "Triggering embeds from manager" above. The
operator runs PR1's `pnpm run-embeds --report-out=<path>`, reads
the resulting `missingArtifacts: [{ assetId, coreId, kind }]` list,
and either accepts the gap or asks manager to PRODUCE the missing
upstream artifacts via the new outbound dispatch.

**GraphQL mutation:** `triggerManagerEnrichment(assetIds: [Int!]!,
coreIds: [String!]!, kind: String!): JSON!`. Gated by the new
permission key `write:manager-enrichment-trigger` (ADMIN-only at
the editorial-tier ladder; also on the WORKFLOW_TRIGGER allowlist
so the CLI's bearer mint can invoke it).

**Outbound HTTPS client:** `src/services/manager-trigger.service.ts`.
POSTs to `${MANAGER_API_BASE_URL}/api/admin-trigger/${kind}` with
`Authorization: Bearer ${MANAGER_TRIGGER_API_KEY}`. Returns a
discriminated `ManagerEnrichmentDispatchResult[]` envelope:
`STARTED | ALREADY_IN_FLIGHT | NOT_FOUND | VALIDATION_FAILED |
DISPATCH_FAILED`. Never throws — synthesises a `DISPATCH_FAILED`
entry per requested assetId on transport / auth / config failure.
`AbortSignal.timeout(15_000)` ceiling.

**CLI:** `pnpm --filter @forge/admin trigger-enrichment`. Two
modes:

- `--from-report=<path> --kind=scene-analysis|transcript`
  (operator-pipeline mode — reads PR1's `missingArtifacts`
  projection, filters by kind, dedupes by assetId).
- `--asset-id=<n> --core-id=<id> --kind=...` (manual paired flags,
  repeatable for multi-id triggers).

The CLI prints one JSON line per outcome plus a summary line.
Exits non-zero if any outcome is `NOT_FOUND | VALIDATION_FAILED |
DISPATCH_FAILED`.

**Env on `forge-admin` Doppler:**

- `MANAGER_API_BASE_URL` — manager's base URL (e.g.
  `https://manager.jesusfilm.org` in prod, `http://localhost:3002`
  locally).
- `MANAGER_TRIGGER_API_KEY` — must match an entry in manager's
  `ADMIN_TRIGGER_API_KEYS` CSV. Rotation is symmetric to the
  reverse direction (stage on receiver first, then deploy caller).

**Wire format note:** the mutation accepts parallel `assetIds` /
`coreIds` arrays paired positionally (rather than an input-object
list). Both come from PR1's `missingArtifacts` projection, so the
CLI populates them trivially. Strapi v5 GraphQL exposes no numeric
`id` filter on `Video`, so manager looks up the cms record by
`coreId`; `assetId` is the operator-facing identifier and the
storage-key prefix manager uses when writing artifacts.

See `docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md`
for the full architecture, deviation rationale (in-memory
idempotency vs EnrichmentJob; new transcript-only pipeline vs
videoEnrichment.ts extraction), and Railway deploy-ordering
invariant.

## Search eval contracts

Admin no longer ships the retired local search-eval CLI harness, its operator
data directory, or its legacy eval service namespace. Mastra owns offline search
evaluation orchestration, query generation, judging, reporting, and native eval
suites; see `apps/mastra/CLAUDE.md` for that runbook.

Admin still owns the authenticated HTTP contracts and persistence that
Mastra uses:

- `POST /api/internal/search-eval/catalog-context` is backed by
  `src/services/search-eval-catalog-context.ts` and
  `src/services/search-eval-locale-profiles.ts`.
- `POST /api/internal/search-eval/candidates`, `GET
/api/internal/search-eval/candidates`, and candidate review actions
  are backed by `src/services/search-eval-candidates.ts`.
- `POST /api/internal/search-eval/search` calls Admin's live search
  service without writing production search traces.
- `POST /api/internal/search-traces/sample` remains the Admin-owned
  raw-trace sampling contract for Mastra's eval seed/baseline work.

The optional OpenRouter search trace query classifier lives at
`src/services/search-trace-query-classifier.ts`. It is limited to
ambiguous or high-impact trace samples, stores separate LLM provenance,
and must never alter live search results. `OPENROUTER_QUERY_CLASSIFIER_MODEL`
remains only as its optional model override in Admin.

Historical design notes for the retired Admin harness remain under
`docs/brainstorms/` and older `docs/plans/`, but they are not current
operator instructions.

## Search API authentication (Plan 002 + Plan 003)

Admin's public search surface — `GET /api/search` REST + `Query.search`
GraphQL twin — is gated by a bearer-key passport. Phase 1 (Plan 002)
shipped in **dual-accept** mode (anonymous + bearer-auth both
succeed); a single env-var flip moves it to **required-auth**
(anonymous returns 401). Plan 003 (partner-key store) retired the
legacy `SEARCH_API_KEYS` env-CSV branch — external-partner
credentials now live in admin's `PartnerApiKey` Postgres table. See
§"Partner API key store" for the DB-backed surface.

### Design summary

- **The bearer is a passport, not a budget.** Per-IP rate limiting
  at 30/min stays for everyone — authed and anonymous alike. Rate-
  limit fires BEFORE the auth check on the REST surface so junk
  Authorization headers cannot bypass the bucket.
- **Search passport accepts any of three known-caller bearer
  sources:**
  1. **PARTNER** — DB-backed `PartnerApiKey` row (Plan 003 — see
     §"Partner API key store" for the token shape, issuance CLI,
     and dashboard view). Runs FIRST so the structured log emits
     `source=partner keyId=<id>` for partner traffic.
  2. **CONSUMER** — `WEB_ADMIN_API_KEYS` env CSV (apps/web SSR +
     apps/mobile rate-limit identity).
  3. **WORKFLOW** — `WORKFLOW_API_KEYS` env CSV (workflow-trigger;
     manager → admin proxies + the eval CLI's bearer mint).

  `isAnyKnownBearer(authHeader)` in `src/auth/search-bearer.ts`
  OR-composes them and returns `{ valid, source, keyId?, fleetKeyId? }`
  (`fleetKeyId` — sha256-prefix of a fleet key — is the bucket id the F1 #2
  global search ceiling keys on; see "Fleet-aware rate-limit bucketing").

- **The disjointness invariant** (`assertBearerCsvsDisjoint` at
  boot in `src/config/env.ts`) holds for the three remaining env
  CSVs (workflow, web-admin, backup-download). Each env-CSV key
  VALUE lives in exactly one CSV; an operator who pastes a value
  into two CSVs hits a fail-fast boot error with the offending
  value redacted. `PartnerApiKey.keyHash` is uniqueness-enforced
  in Postgres separately; a plaintext that ALSO appears in an env
  CSV tags as `source=partner` (the partner branch runs first).
- **`BACKUP_DOWNLOAD_API_KEYS` is excluded** from
  `isAnyKnownBearer` — it's a narrow file-download surface (the
  presigned video-DB backup endpoint), not an active-API bearer.
- **Structured log per request** tags every call with one of
  three states: `auth=bearer source=<branch> [keyId=<id>]` (matched,
  with `keyId` only on partner branches), `auth=invalid_bearer`
  (presented + no match — the population that 401s after the
  flip), or `auth=anonymous` (no header). Grep these in admin
  logs before the `SEARCH_AUTH_REQUIRED` flip to confirm every
  known internal caller is on a known bearer.

### Env vars (`forge-admin` Doppler)

- `SEARCH_AUTH_REQUIRED` — `"true" | "false"`, defaults to
  `"false"`. When `"true"`, requests without a known bearer return
  401 (REST) or throw `Authentication required` (GraphQL).
  Enum-of-strings (not boolean) so a stray non-empty value can't
  silently flip the gate.
  The legacy `SEARCH_API_KEYS` receiver-side CSV was retired in
  Plan 003; today's partner credentials are issued via the
  `partner-keys create` CLI and live in `PartnerApiKey`.

### Issuance + rotation

For external partners, see §"Partner API key store" — the
`pnpm --filter @forge/admin partner-keys create` CLI issues a
DB-backed token, prints it once to stderr for operator handoff,
and persists the sha256 hash.

For internal callers (apps/web, manager), keys live in the respective
env CSVs (`WEB_ADMIN_API_KEYS`, `WORKFLOW_API_KEYS`)
and rotate via Doppler edit + Railway redeploy. **Receiver-first
deploy ordering** for any internal-bearer rotation:

1. Add the new key to the env CSV on admin Doppler. Deploy admin.
   The new key is now accepted alongside the old.
2. Update the caller's env to the new value. Deploy the caller.
3. After observation confirms no callers use the old key, remove
   the old key from the env CSV. Deploy admin.

Reversing the order produces a dead minute where the caller 401s.
Per `docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md`
§"Railway deploy-ordering invariant".

### Required-auth flip (Phase 4 of plan 002)

Before flipping `SEARCH_AUTH_REQUIRED=true` on prod:

1. Grep admin logs for `auth=anonymous` over the past 72h.
2. For every remaining anonymous caller, identify by source IP +
   User-Agent. Confirm it's either (a) an external scraper we
   intend to reject, or (b) a known-internal caller that missed
   the migration → fix BEFORE flipping.
3. Flip the flag on Doppler, deploy admin, monitor 401 rate for
   the next hour. Spike on anonymous = expected. Spike on
   known-internal IPs = roll back the flag.

### Files

- `src/auth/search-bearer.ts` — `isAnyKnownBearer` composer
  (async, returns `BearerCheckResult`; OR-composes PARTNER →
  CONSUMER → WORKFLOW; the CONSUMER branch reports `source=fleet`
  for a `FLEET_ADMIN_API_KEYS` key, else `source=consumer`).
- `src/auth/partner-token.ts` — pure helpers for the partner token
  format (`jfp_search_<keyId>_<random>`).
- `src/services/partner-api-key.service.ts` — DB-backed partner
  branch (`verifyPartnerToken` with Promise.race 1500ms timeout +
  fire-and-forget `lastUsedAt` update).
- `src/app/api/search/route.ts` — REST handler; rate-limit fires
  first, then the auth check.
- `src/graphql/queries/hybrid-search.ts` — GraphQL resolver; same
  auth check inside the resolver body, `authScopes: { public: true }`
  stays.
- `src/config/env.ts` — `SEARCH_AUTH_REQUIRED` enum +
  `assertBearerCsvsDisjoint` over the 3 remaining env CSVs.

### Fleet-aware rate-limit bucketing (apps/tv + apps/mobile)

TV and mobile ship the SAME consumer bearer baked into every install, so a flat
`consumer:<key>` bucket would collapse the whole fleet into one 60/min limit
(self-DoS). `FLEET_ADMIN_API_KEYS` is a dedicated consumer-bearer CSV whose keys
mint the normal `CONSUMER_BEARER` principal (zero permissions) but flagged
`fleet`, so `identifyForRateLimit` buckets them per device: by a client-provided
`viewer_id` as `consumer:<key>:v:<viewer_id>` when present (preferred), else per
client IP as `consumer:<key>:<ip>`. Web SSR (`WEB_ADMIN_API_KEYS`) stays flat
`consumer:<key>`.

- **Trusted IP only (R8).** The `<ip>` comes from `getTrustedClientIp`
  (`cf-connecting-ip` only) — never the client-supplied `x-forwarded-for`. The
  fleet key is extractable from the app bundle and per-IP is its sole abuse
  control, so a spoofable IP would let a holder mint buckets or pin a victim. No
  trusted IP → `consumer:<key>:unknown` (fleet namespace, not `public:unknown`).
- **Per-`viewer_id` (preferred, CGNAT-immune).** When the client sends a valid
  `x-viewer-id` header (sanitized: 1–64 chars `[A-Za-z0-9._-]`), fleet traffic
  buckets `consumer:<key>:v:<viewer_id>` — one bucket per app launch (the client id
  is in-memory, regenerated on relaunch), regardless of NAT, so co-egress carrier
  devices don't collapse. `viewer_id` is client-set and freely rotatable, so it is
  an availability label ONLY (never identity/authz) and makes minting fresh buckets
  TRIVIAL (rotate a header, cheaper than rotating IPs) — so it is safe ONLY once the
  F1 global per-fleet-key ceiling is live. That ceiling (BLOCKING precondition #2
  below) is the SOLE abuse bound, not this per-device key. The `v:` prefix keeps a
  spoofed IP-shaped id from colliding with a real IP bucket. Absent/malformed → IP
  fallback (additive, inert until clients send it).
- **Disjoint at boot.** `FLEET_ADMIN_API_KEYS` joins `BEARER_CSV_KEYS` and the
  `assertBearerCsvsDisjoint` invariant; a value shared with any other bearer CSV
  fails the boot. Mint a DEDICATED fleet key per surface (tv, mobile) — never
  reuse web SSR's or another surface's value.
- **Observable.** A fleet key logs `source=fleet` in the per-request search log
  (vs web SSR's `source=consumer`); a rising `consumer:*:unknown` share signals a
  `cf-connecting-ip` drop / AOP regression collapsing the fleet.
- **Carrier-NAT residual (IP path only).** Devices behind one carrier-grade NAT
  egress that do NOT send a `viewer_id` share a single `consumer:<key>:<ip>` 60/min
  bucket — the multi-user-per-IP collapse re-scoped to per-carrier-egress; the
  mobile cellular fleet is most exposed. A client that sends `x-viewer-id` avoids
  this entirely (per-device bucket). For the IP-only fallback, the limit is
  server-side tunable (raise the cap; no client rebuild) or lean on the F1 ceiling.

**Deploy ordering (receiver-first).** Land the fleet keys in admin's
`FLEET_ADMIN_API_KEYS` BEFORE provisioning the client
`EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN` in EAS. Rotation overlap is WEEKS, not
sub-hour: store binaries update at user discretion, so keep the old fleet key
valid until install metrics confirm the new build reached the fleet.

**Before shipping a fleet token — F1 preconditions, both BLOCKING:**

1. Confirm Cloudflare Authenticated Origin Pulls is enforced and the raw
   `*.up.railway.app` origin is unreachable/403 (probe + record) — R8's
   unspoofability rests entirely on this.
2. Land a real abuse ceiling on the search path (a Cloudflare edge rate-limit
   keyed on the fleet bearer, or an app-level global per-fleet-key counter):
   per-IP does NOT bound an attacker rotating IPs with the extracted key.

**Abuse-incident runbook.** Env-CSV keys have no sub-second per-key revocation
(unlike the DB-backed partner store). To revoke a compromised fleet key: rotate
`FLEET_ADMIN_API_KEYS` + redeploy (revokes fleet-wide immediately, but fleet
search breaks until a new build ships); use a Cloudflare edge block of the
abusive pattern as the no-user-impact interim.

See `docs/plans/2026-07-08-002-feat-admin-fleet-aware-rate-limit-bucketing-plan.md`.

### Cross-references

- **Primary learning doc:**
  `docs/solutions/architecture-patterns/bearer-as-passport-multi-csv-composition-20260518.md`
  — the OR-composition pattern + disjointness invariant + rate-limit-
  before-auth + receiver-first deploy ordering.
- **Companion learnings:**
  - `docs/solutions/best-practices/waf-passthrough-verification-via-prior-art-20260518.md`
    (how WAF passthrough was verified without fresh probes).
  - `docs/solutions/runtime-errors/railway-logsv2-silences-nextjs-stdout-runtime-20260518.md`
    (why the structured `search.request` log emits via `console.warn`
    not `console.log`).
- Plan: `docs/plans/2026-05-17-002-feat-search-api-auth-plan.md`
- Brainstorm:
  `docs/brainstorms/2026-05-17-search-api-auth-requirements.md`
- Sibling pattern (workflow direction):
  `docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md`
- Sibling pattern (consumer-bearer):
  `docs/solutions/architecture-patterns/consumer-bearer-rate-limit-identity-pattern-20260513.md`

## Partner API key store

DB-backed external-partner credentials for `/api/search` + `Query.search`.
Extends Plan 002's bearer-as-passport composer with a fourth branch
(`PartnerApiKey` table in admin's Postgres) that validates BEFORE the
env-CSV `search` fallback fires. Internal callers (apps/web,
workflow-trigger callers, backup-download) stay on their respective env
CSVs — partner keys are the only credential class with audit, sub-second
revocation, and per-key metadata requirements.

See:

- Plan: `docs/plans/2026-05-18-001-feat-partner-api-key-store-plan.md`
- Brainstorm: `docs/brainstorms/2026-05-18-002-partner-api-key-store-requirements.md`

### Design summary

- **Token format `jfp_search_<keyId>_<random>`.** `keyId` is a 12-char
  operator-visible identifier (URL-safe alphabet excluding `_` and
  visually-confusable `0/O/I/l/1`). `random` is `base64url(32 bytes)`
  = 43 chars of entropy. The stored form is `sha256(rawToken)` as
  64-char hex; comparison via `timingSafeEqual` on decoded buffers.
- **Composer ordering** in `isAnyKnownBearer` is PARTNER → CONSUMER →
  WORKFLOW → SEARCH (legacy env CSV). The partner branch runs FIRST so
  the structured log emits `source=partner keyId=<id>` for seeded rows
  even while the env-CSV `search` branch is still active during the
  cutover window.
- **Per-request log line** extends the working
  `[search] event=search.request auth=… path=… rl=…` format with
  `source=<branch>` (every successful match) and `keyId=<id>` (partner
  matches only). Plain-string per the Railway logsV2 silencing
  learning — `JSON.stringify` payloads from this surface are silenced.
- **Outbound timeout.** The Prisma lookup wraps in `Promise.race`
  against `PARTNER_KEY_LOOKUP_TIMEOUT_MS = 1500`. On timeout, log
  `event=partner_key.lookup_timeout` and fall through to the env-CSV
  branches (graceful degradation while dual-accept is live; fail-closed
  after PR3 retires the CSV).
- **Fire-and-forget `lastUsedAt`.** Updates are dispatched via `void
prisma.partnerApiKey.update(...).catch(...)` — never `await`-ed, never
  allowed to crash the request. Sync throws on the wrapper are caught
  separately (see `docs/solutions/best-practices/in-memory-slot-reservation-fire-and-forget-20260506.md`).
- **Soft revocation.** `revoked_at` set, row preserved. Preserves the
  audit trail (which key was revoked, when, by whom). Hard delete is
  out of scope in v1.
- **No in-process cache in v1.** Per the plan: cache adds slot-leak
  surface and multi-replica revocation skew for ~10ms savings nobody
  will notice. Each replica makes its own Prisma round-trip; revocation
  propagates immediately. Revisit if profiling shows the lookup as a
  hot path.

### Schema (Prisma)

`PartnerApiKey` model (`prisma/schema.prisma`, migration
`0015_partner_api_keys`):

| Column        | Type                                     | Notes                                        |
| ------------- | ---------------------------------------- | -------------------------------------------- |
| `id`          | `String @id @default(cuid())`            |                                              |
| `keyId`       | `String @unique @map("key_id")`          | 12 chars, operator-visible, surfaced in logs |
| `keyHash`     | `String @unique @map("key_hash")`        | `sha256(rawToken)`, 64 hex chars             |
| `name`        | `String`                                 | partner display name                         |
| `ownerEmail`  | `String @map("owner_email")`             | offboarding contact                          |
| `note`        | `String?`                                | free-form operator note                      |
| `lastUsedAt`  | `DateTime? @map("last_used_at") @@index` | fire-and-forget per-auth update              |
| `revokedAt`   | `DateTime? @map("revoked_at") @@index`   | soft-revoke; `NULL` = active                 |
| `createdById` | `String? + relation → User (SetNull)`    | who issued                                   |
| `revokedById` | `String? + relation → User (SetNull)`    | who revoked                                  |

### Code surfaces

- `src/auth/partner-token.ts` — pure helpers (`generatePartnerToken`,
  `parsePartnerToken`, `hashRawToken`, `timingSafeEqualHex`).
- `src/services/partner-api-key.service.ts` — `createPartnerKey`,
  `listPartnerKeys`, `revokePartnerKey` (conditional `updateMany`
  guards against concurrent-revoke `revokedById` clobber),
  `rotatePartnerKey`, `verifyPartnerToken` (the hot-path validator
  with `Promise.race` timeout + fire-and-forget `lastUsedAt`
  update). Exports `PartnerKeyNotFoundError`.
- `src/auth/search-bearer.ts` — exports `BearerCheckResult` +
  `BearerSource`. `isAnyKnownBearer` is async, returns the enriched
  result, runs the partner branch FIRST.
- `src/app/api/search/route.ts` + `src/graphql/queries/hybrid-search.ts`
  — both await the composer and thread `source` / `keyId` into the
  per-request log line.
- `src/scripts/partner-keys.ts` — CLI: `create | list | revoke | rotate`.
- `src/app/dashboard/partner-keys/page.tsx` — read-only dashboard
  view, ADMIN-only via `requireAdminSession`.

### Operator runbook

#### Issue a key for a new partner (under 5 operator minutes)

```bash
pnpm --filter @forge/admin partner-keys create \
  --name="Acme Partner" \
  --owner-email="ops@acme.example" \
  --note="Q3 2026 integration" \
  --operator-email="<your-email>"
```

The CLI prints structured JSON events on stdout (one per line, including
`partner-key.created` with `keyId`) and the plaintext token EXACTLY ONCE
on stderr inside a banner. **Save the token from stderr** — it is not
retrievable afterward (only the sha256 hash persists). Share the token
with the partner via Slack DM. First partner request lands in Railway
logs as `auth=bearer source=partner keyId=<id>`.

#### Revoke a key (under 30 seconds — SC2)

```bash
pnpm --filter @forge/admin partner-keys revoke <keyId> \
  --operator-email="<your-email>"
```

Sets `revoked_at = NOW()`. The next request from that key returns 401
(or, in dual-accept mode, falls through to the env-CSV branch — until
PR3 retires it). No admin redeploy required. Idempotent: re-revoking an
already-revoked key prints the existing row's revoked_at and exits 0.

#### Rotate a key (with grace window)

```bash
pnpm --filter @forge/admin partner-keys rotate <oldKeyId> \
  --operator-email="<your-email>"
```

Issues a new key for the same partner, leaves the OLD key active.
Operator shares the new token with the partner, partner cuts over,
then operator runs `partner-keys revoke <oldKeyId>` once
`/dashboard/partner-keys` shows non-null `lastUsedAt` on the new keyId.

#### List partner keys

```bash
# Active keys only (default)
pnpm --filter @forge/admin partner-keys list

# Including revoked rows
pnpm --filter @forge/admin partner-keys list --include-revoked
```

Or check `/dashboard/partner-keys` — same data, sortable in a browser,
includes revoked rows by default for the audit trail.

#### Migrating an existing partner from the legacy `SEARCH_API_KEYS` env CSV

The legacy `SEARCH_API_KEYS` receiver-side CSV was retired in Plan 003
without an in-place migration tool — the opaque legacy token shape
cannot round-trip through `verifyPartnerToken` (which requires
`jfp_search_<keyId>_<random>`). Instead, **rotate the partner onto a
fresh DB-backed key**:

1. `partner-keys create` to issue a new `jfp_search_*` token.
2. Share the new token with the partner via Slack DM; partner updates
   their integration and deploys.
3. Verify in Railway logs that the partner's traffic flips to
   `auth=bearer source=partner keyId=<id>`.
4. Remove the partner's old value from `SEARCH_API_KEYS` in Doppler.
   (Plan 003 already retired the env-CSV branch in code — this step
   just clears dead config.)

### Cross-references

- **Primary learning doc:**
  `docs/solutions/architecture-patterns/db-backed-vs-env-csv-credential-storage-20260518.md`
  — the decision matrix for when to use DB-backed credentials vs.
  env-CSV. Documents the composer-ordering decision, hot-path lookup
  timeout pattern, fire-and-forget `lastUsedAt` discipline, and CLI
  plaintext-once UX as a future-reference pattern for any future
  partner-credential surface.
- **Companion learnings:**
  - `docs/solutions/architecture-patterns/bearer-as-passport-multi-csv-composition-20260518.md`
    (the OR-composition foundation this extends).
  - `docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md`
    (Prisma lookup wrap rationale).
  - `docs/solutions/best-practices/in-memory-slot-reservation-fire-and-forget-20260506.md`
    (`lastUsedAt` update wrapper discipline).
  - `docs/solutions/runtime-errors/railway-logsv2-silences-nextjs-stdout-runtime-20260518.md`
    (why the new `source=` / `keyId=` log fields are appended as
    plain-string key=value pairs, not JSON).
  - `docs/solutions/database-issues/db-lock-must-be-atomic-update-not-select-for-update.md`
    (conditional `updateMany` discipline for the soft-revoke race
    fix — Worked instance 2 is `revokePartnerKey`).
  - `docs/solutions/security-issues/pre-verification-log-field-namespace-pollution-20260518.md`
    (`attemptedKeyId=` vs `keyId=` log-field-namespace discipline).
  - `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`
    §"Recovery when contracts are structurally broken" — the
    `import-from-env` deletion case.

## Scripture Passages

Admin owns YouVersion provider access for Watch Bible passage rendering. Keep
`YOUVERSION_APP_KEY` and `YOUVERSION_PASSAGE_CACHE_TTL_SECONDS` in Admin
environments only. The approved Watch language slug / Core language id →
YouVersion-version table lives in
`src/services/scripture-passage.service.ts` as reviewed code; missing languages
fall back to the launch English BSB version. Only full-Bible YouVersion
candidates belong in the launch table; partial/NT-only candidates require
explicit product approval. Web reads cached passage text through GraphQL
`BibleCitation.passage(languageSlug:)`; other consumers may pass Core
`languageId`. Web and consumers must not call the provider API directly.

## Common pitfalls (grows with each unit)

- **Per-service `railway.toml` files are ignored until Config-as-code Path is set.** For Admin, set it to `apps/admin/railway.toml` before assuming code-owned config applies. Trap surfaced 2026-04-29 after silently skipping 5 PRs of migrations; see `docs/solutions/deployment/railway-dashboard-override-shadows-railway-toml-20260429.md`.
- **Railway MCP writes are staged, not applied** — `updateServiceTool` writes to a buffer; flush with `accept-deploy(environmentId)`, not `redeploy`. See `docs/solutions/platform/railway-mcp-staged-config-never-commits-20260420.md`.
- `[deploy.env]` in `railway.toml` is unreliable — put env vars in Railway dashboard.
- PostgreSQL 18 on Railway: `?::jsonb::text[]` cast unsupported. Use PG array
  literal `{val1,val2}` with `?::text[]` — see `src/db/pgvector.ts::toPgArray()`.
- Prisma 7.1.0 has pgvector migration regressions (Prisma issue #28867). Pin
  to Prisma 6.x until resolved.
- Pothos Prisma plugin requires `dmmf: Prisma.dmmf` in the builder config
  when `client` is a function (not a direct instance).
- Next.js App Router route handlers cannot directly export the Yoga instance:
  type signatures mismatch. Wrap in a `(request, context) => yoga.handle(...)`
  function and export that as `GET`/`POST`/`OPTIONS`.
