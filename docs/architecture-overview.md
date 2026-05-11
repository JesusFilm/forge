# Forge — Architecture Overview (Onboarding)

> Audience: a new contributor who needs a map of what each app does, how the apps fit together, and where each piece of data lives. Written 2026-05-08.

Forge is a JFP (JesusFilm) ministry content platform. It is a pnpm + Turborepo monorepo. Everything deploys to Railway; Cloudflare sits in front for DNS, WAF, and Authenticated Origin Pulls.

## 1. Apps and packages at a glance

```
apps/
  cms/       Strapi v5 — legacy CMS. Source of truth for consumer apps today.
  admin/     Next.js 16 — strategic replacement for Strapi. Custom GraphQL (Yoga + Pothos)
             over Prisma + Postgres + pgvector. Better Auth for identity. useworkflow for jobs.
             Long-term home for manager too.
  manager/   Next.js — AI video enrichment orchestrator. Mux ingest → transcribe → translate
             → chapters → metadata → embeddings → S3 → sync to Strapi/admin.
  web/       Next.js 16+ App Router — public website.
  mobile/    Expo / React Native (managed workflow, EAS builds).
  tv/        Expo (SDK 54, react-native-tvos) — Apple TV + Android TV. SDUI app variant.
  roadmap/   Next.js — internal viewer for docs/roadmap/*.md.

packages/
  graphql/        gql.tada typed client. Generates types from TWO SDL files:
                  apps/cms/schema.graphql      → exports `graphql()`
                  apps/admin/schema.graphql    → exports `adminGraphql()`
                  Single source of truth for typed GraphQL ops in web/mobile/tv.
  video-player/   Shared video player primitives.
```

The dual GraphQL client exists only during the Strapi → admin consumer migration. Once all consumer routes have moved, the package collapses back to a single admin-bound client.

## 2. The "platform database link" — who owns what data

Three independent Postgres databases, one per stateful service. They are **not** federated; cross-app data movement is explicit.

```
┌─────────────────────────────┐    ┌─────────────────────────────┐    ┌─────────────────────────────┐
│  apps/cms (Strapi v5)       │    │  apps/admin                 │    │  apps/manager               │
│                             │    │                             │    │                             │
│  Postgres (strapi DB)       │    │  Postgres + pgvector        │    │  File-backed local state    │
│  • Content types (CMS UI)   │    │  • Better Auth tables       │    │  (src/lib/state.ts) +       │
│  • Editorial workflow       │    │  • Core projection (Video,  │    │  Postgres-backed workflow   │
│  • Public/published content │    │    Language, Country,       │    │  queue when deployed.       │
│                             │    │    Keyword, Edition, Mux …) │    │  No long-lived domain DB.  │
│  GraphQL plugin → /graphql  │    │  • VideoLocale & friends    │    │                             │
│                             │    │    (per-locale rows)        │    │                             │
│                             │    │  • Embeddings (pgvector,    │    │                             │
│                             │    │    never exposed in GraphQL)│    │                             │
│                             │    │  • useworkflow tables       │    │                             │
│                             │    │  Yoga + Pothos /api/graphql │    │                             │
└──────────────┬──────────────┘    └──────────────┬──────────────┘    └──────────────┬──────────────┘
               │                                  │                                  │
               │ GraphQL (gql.tada `graphql()`)   │ GraphQL (gql.tada `adminGraphql()`) │ HTTP triggers
               ▼                                  ▼                                  │
        ┌─────────────────────────────────────────────────────────┐                  │
        │  apps/web, apps/mobile, apps/tv                          │                 │
        │  (consumers — migrating route-by-route from cms → admin) │                 │
        └─────────────────────────────────────────────────────────┘                  │
                                                                                     │
                          ┌──────────────────────────────────────────────────────────┘
                          │
                          ▼
                ┌─────────────────────────────────────────────────────┐
                │  External / shared infra                             │
                │  • Railway S3 — admin write bucket; manager read-only│
                │    bucket for artifacts                              │
                │  • Mux — video ingest, HLS, durations on             │
                │    video_variants.duration (mux_videos.duration is 0)│
                │  • OpenRouter / OpenAI / ElevenLabs — model providers│
                │  • Cloudflare — DNS, WAF, Auth Origin Pulls          │
                │  • Doppler — secret sourcing for local dev           │
                │  • Better Auth + Firebase fallback (admin only)      │
                └─────────────────────────────────────────────────────┘
```

### Database ownership rules

- **apps/cms (Strapi)** — its own Postgres. Strapi v5 uses snake_cased columns (`bcp47` → `bcp_47`). Consumer apps must not call Strapi REST; they go through the GraphQL plugin.
- **apps/admin** — its own Postgres with the `vector` extension. Prisma is the *sole* data access layer. UI never accesses the DB directly. Pothos `prismaField` / `t.relation` handles reads with `...query` passthrough; services own mutations, raw SQL (pgvector), and ABAC enforcement. Embedding columns never appear in a GraphQL type.
- **apps/manager** — no long-lived domain DB. State is file-backed (`src/lib/state.ts`) plus a Postgres-backed workflow queue when deployed. All durable enrichment results land in Strapi (today) or admin (as routes migrate).
- **Core sync** — admin pulls a read-only projection of Core data (Video, Language, Country, Keyword, Edition, Mux metadata, …) on a recurring job. Core-sourced entities are read-only at admin's GraphQL layer in v1.

### Cross-app trigger paths (bidirectional, key-asymmetric)

```
manager → admin     POST /api/admin-embeds/{scene,transcript}
                    ↓ forwards to admin GraphQL trigger mutations
                    Auth: caller-side single key (manager: WORKFLOW_API_KEY)
                          receiver-side CSV (admin: WORKFLOW_API_KEYS)

admin   → manager   triggerManagerEnrichment → POST /api/admin-trigger/*
                    Auth: caller-side single key (admin: MANAGER_TRIGGER_API_KEY)
                          receiver-side CSV (manager: ADMIN_TRIGGER_API_KEYS)
```

Receiver deploys the keyring entry **first**, then caller deploys its env var. Reversed order produces a dead minute of 401s. Source of truth: `docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md`.

## 3. The GraphQL contract flow

There are two parallel codegen pipelines, both consumed by `packages/graphql`:

```
apps/cms       → schema.graphql auto-emitted by Strapi    ─┐
                                                            ├─▶ packages/graphql codegen
apps/admin     → schema.graphql via Pothos `schema:print`  ─┘    → graphql-env.d.ts
                                                                  → admin-graphql-env.d.ts
                                                            ▼
                                                  graphql() and adminGraphql()
                                                            ▼
                                              consumed by apps/web, mobile, tv
```

CI guards: `admin-schema-drift` job catches a missing `schema:print`; `graphql-generate` job catches missing client regeneration. Both regenerated SDL files commit alongside the source change.

## 4. Where to look first

| Question | File |
|---|---|
| Project-wide rules | `CLAUDE.md`, `AGENTS.md` (root) |
| What each app's boundary is | `apps/<app>/CLAUDE.md` and `apps/<app>/AGENTS.md` |
| Admin DB shape | `apps/admin/prisma/schema.prisma` |
| Admin GraphQL contract | `apps/admin/schema.graphql` (generated, committed) |
| Strapi GraphQL contract | `apps/cms/schema.graphql` (generated, committed) |
| Manager pipeline entry | `apps/manager/src/workflows/videoEnrichment.ts` |
| Cross-app trigger code | `apps/admin/src/app/api/admin-embeds/*`, `apps/manager/src/app/api/admin-trigger/*` |
| Active work / planned work | `docs/roadmap/` (rendered by `apps/roadmap`) |
| Past learnings (do this BEFORE designing) | `docs/solutions/` |

## 5. The deploy and secrets picture

- **Compute**: every app is its own Railway service. Configured via `railway.toml` or the dashboard.
- **Edge**: Cloudflare in front of Railway. DNSSEC + Authenticated Origin Pulls required for the cms → web preview path.
- **Secrets local**: `pnpm fetch-secrets` from inside an app pulls Doppler (project per app, e.g. `forge-cms`, `forge-web`).
- **Secrets deployed**: Railway service environment variables. No `.env` files in git.

## 6. Important invariants new contributors trip on

- **Mux duration** lives on `video_variants.duration`. `mux_videos.duration` is always 0.
- **PostgreSQL 18 (Railway)** does not support `?::jsonb::text[]`. Use PG array literal `{val,val}` with `?::text[]`.
- **`json_array_elements_text(jsonb)` does not exist.** Use `jsonb_array_elements_text` after a `::jsonb` cast.
- **AWS S3 NoSuchKey** classification must match by `error.name`, not message text.
- **Outbound timeouts** on server routes calling Apollo/pg/http must be strictly shorter than the upstream caller's budget (`Promise.race` + typed `TimeoutError`).
- **AI can draft, never publish.** The publish transition is human-only and role-gated in apps/cms. Mirror that posture in apps/admin.

## 7. Quick mental model

> Strapi is the CMS today. Admin is the CMS tomorrow. Manager is the AI workshop that feeds both. Web/mobile/tv are render heads that go through `packages/graphql`. Cloudflare and Railway are the only deploy substrate. Everything else is a service boundary you cross with an explicit contract.
