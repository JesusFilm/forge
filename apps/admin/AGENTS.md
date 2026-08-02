# apps/admin Agent Guide

Full context in `apps/admin/CLAUDE.md`. Both files stay aligned.

## Core model

- Canonical content/admin service for apps/web, apps/mobile, apps/tv, and
  apps/manager-owned read models.
- Custom GraphQL API via Yoga + Pothos at `/api/graphql`.
- Prisma + Postgres + pgvector — sole data access layer.
- Admin treats `apps/auth` as the Jesus Film SSO authority and creates an
  admin-local session after issuer/audience/scope verification.
- useworkflow for durable background jobs.
- For worktree previews, follow `apps/admin/docs/worktree-preview-setup.md`
  before starting a server or mutating a shared local database.

## Architecture rules (load-bearing)

- UI never accesses the database directly.
- Pothos `prismaField` / `t.relation` handles reads with `...query` passthrough.
- Services own mutations, raw SQL (pgvector), and ABAC enforcement.
- Admin owns live search orchestration, query embedding generation, vector
  storage, production search traces, raw trace retention, aggregates, and the
  internal trace sampling/catalog/candidate/eval-search contracts. The internal
  eval-search contract must not write production traces. Trace labels are
  deterministic rules-first with privacy/sensitivity redaction kept separate
  from query usefulness and abuse labels. Optional LLM classification is
  offline/eval-only, lives in `src/services/search-trace-query-classifier.ts`,
  and stores separate provenance. Mastra reads and writes search-eval data
  through authenticated Admin HTTP only; it must not import Admin code or read
  Admin Postgres.
- Admin auth must not depend on shared `.jesusfilm.org` cookies or
  admin-local credential handlers.
- Every Pothos type is classified `abac-gated` or `public-shape` — `abac-gated`
  types cannot be the target of `t.relation`; reach them through services.
- Core-sourced entities (Video, Language, Country, Keyword) are read-only at
  the GraphQL layer in v1.
- Core sync now covers the full approved Core projection: languages, countries,
  country-language relations, keywords, videos, video locales, origins, images,
  subtitles, study questions, Bible citations, keyword links, parent-child
  links, dubs, editions, Mux metadata, and dub downloads.
- Mastra owns background transcript and experience embedding generation.
  Admin owns the remaining type-specific ingest validation, vector storage,
  publication gates, pgvector indexes, target resolution, public search
  contracts, and search retrieval. The legacy scene embedding writer/Admin
  ingest path is retired; historical scene rows are retained for feat-199 and
  scene analysis artifacts are non-search source artifacts. Coordinated
  all-content replacement uses
  `run-embeds --pipeline=all` only after a passed Mastra content search-eval
  gate report from `docs/search-eval-reports/`.
- Live user search query embedding generation stays in Admin's search services;
  do not move live search orchestration into Mastra.
- Video snapshots have two scheduled products: `video-core` is the default
  local restore, while explicit `--profile=video-search` adds the stored scene
  and transcript/vector tables. Snapshot publication copies existing vectors;
  it must not generate embeddings or add an embedding-readiness gate.
- Native `pg_dump`, `psql`, and `pg_restore` commands receive a sanitized copy
  of the selected database URL. Never mutate `DATABASE_URL` or
  `DATABASE_URL_SYNC`, and never remove their Prisma `connection_limit` or
  `pool_timeout` settings: embedding backfill concurrency and Core Sync pool
  isolation rely on those application URLs.
- Localized Core content that is user-facing, retrieval-relevant, or UI-edited
  belongs in per-locale rows (`VideoLocale`, `VideoStudyQuestion`,
  `LanguageLocale`, `CountryLocale`, `ContinentLocale`). Legacy JSON `name`
  maps are compatibility mirrors only.
- Embedding vector columns never appear in a GraphQL type (technical control,
  not convention).
- Raw production search traces may retain query text only after first-pass
  privacy labeling/redaction and for less than 30 days. Aggregates survive
  without query text; never store bearer tokens, cookies, IPs, user ids, or
  caller-supplied key ids in trace tables. Trace-derived generated eval
  candidates inherit the same raw expiry and stay staged until human promotion.

## Workflow

- Requirements: `docs/brainstorms/2026-04-13-admin-app-graphql-postgres-requirements.md`
- Plan: `docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md`
- Follow compound engineering: `ce:plan` -> `ce:work` -> `ce:review` -> `ce:compound`.

## SDL emission for consumer codegen

After ANY change to admin's Pothos schema (`src/graphql/types/`, `src/graphql/mutations/`, `src/graphql/queries/`, `src/graphql/builder.ts`):

1. Run `pnpm --filter @forge/admin schema:print` to regenerate `apps/admin/schema.graphql`.
2. Run `pnpm --filter @forge/admin-graphql generate` to regenerate
   `packages/admin-graphql/src/admin-graphql-env.d.ts`.
3. Commit the Pothos source change, `schema.graphql`, and the admin-graphql
   introspection output in the same PR.

The committed SDL artifact is consumed by `packages/admin-graphql`. If SDL changes, regenerate both `apps/admin/schema.graphql` and the admin gql.tada environment in the same PR.

CI's `admin-schema-drift` job catches step 1 if forgotten. The committed SDL is the contract handoff between admin (producer) and the admin codegen consumer.

`schema:print` uses Pothos `printSchema(lexicographicSortSchema(builder.toSchema()))` and strips Pothos plugin directives (`@authScopes` etc.) post-print so gql.tada's parser can consume the output.

## Local-dev scripts (not deployed)

| Script                                                                   | Purpose                                                                                                                 | Env requirement                                                                                                                                      |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @forge/admin run-sync`                                    | Run the Core data sync against any DATABASE_URL                                                                         | DATABASE_URL + Core API creds                                                                                                                        |
| `pnpm --filter @forge/admin core-sync:backfill-video-localized-metadata` | Backfill Core localized video display text and study questions                                                          | DATABASE_URL + Core API creds; requires `--slug`, `--core-id`, `--limit`, or explicit `--full-catalog`; dry-run unless `--execute`                   |
| `pnpm --filter @forge/admin core-sync:backfill-video-relation-order`     | Backfill existing video relation order values from Core children                                                        | DATABASE_URL + Core API creds; requires `--slug`, `--core-id`, `--limit`, or explicit `--full-catalog`; dry-run unless `--execute` + DB hash confirm |
| `pnpm --filter @forge/admin run-embeds`                                  | Run gated transcript/experience embedding workflows locally                                                             | DATABASE_URL + manager S3 + Mastra service keys; `--pipeline=all` also requires a provider-bound `--gate-report=docs/search-eval-reports/<id>.json`  |
| `pnpm --filter @forge/admin restore:video-db`                            | Restore the reviewed video slice into dev/staging Postgres                                                              | TARGET_DATABASE_URL or DATABASE_URL + `--target-env`                                                                                                 |
| `pnpm --filter @forge/admin restore:video-db:latest`                     | Download latest core (default) or `--profile=video-search`, then restore locally; stale latest requires `--allow-stale` | TARGET_DATABASE_URL or DATABASE_URL + BACKUP_DOWNLOAD_API_KEY                                                                                        |
| `pnpm --filter @forge/admin seed-easter`                                 | Seed Easter experience into local Postgres for UI/E2E fixtures                                                          | DATABASE_URL (loaded via `--env-file=.env`); destructive on re-run                                                                                   |
| `pnpm --filter @forge/admin schema:print`                                | Regenerate the committed admin SDL artifact                                                                             | Admin auth env values, dummy local values are OK for generation                                                                                      |

## Boundaries

- Do not break admin-app internal contracts by importing from `apps/web`,
  `apps/mobile`, `apps/mobile-v2`, or `apps/manager`.
- Do not hand-edit `.next/`, generated Prisma Client, or Pothos-generated types.
- Do not introduce new direct `process.env` reads — extend `src/config/env.ts`.
