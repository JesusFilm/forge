# apps/admin Agent Guide

Full context in `apps/admin/CLAUDE.md`. Both files stay aligned.

## Core model

- Strapi replacement + eventual home for apps/manager (long-term). V1 serves
  admin UI only; web/mobile stay on Strapi during the transition.
- Custom GraphQL API via Yoga + Pothos at `/api/graphql`.
- Prisma + Postgres + pgvector — sole data access layer.
- Better Auth for identity; server-side Firebase email/password fallback for
  transparent lazy migration; native SSO for Google/Apple/Okta.
- useworkflow for durable background jobs.

## Architecture rules (load-bearing)

- UI never accesses the database directly.
- Pothos `prismaField` / `t.relation` handles reads with `...query` passthrough.
- Services own mutations, raw SQL (pgvector), and ABAC enforcement.
- Every Pothos type is classified `abac-gated` or `public-shape` — `abac-gated`
  types cannot be the target of `t.relation`; reach them through services.
- Core-sourced entities (Video, Language, Country, Keyword) are read-only at
  the GraphQL layer in v1.
- Embedding vector columns never appear in a GraphQL type (technical control,
  not convention).

## Workflow

- Requirements: `docs/brainstorms/2026-04-13-admin-app-graphql-postgres-requirements.md`
- Plan: `docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md`
- Follow compound engineering: `ce:plan` -> `ce:work` -> `ce:review` -> `ce:compound`.

## Boundaries

- Do not break admin-app internal contracts by importing from `apps/web`,
  `apps/mobile`, `apps/mobile-v2`, `apps/cms`, or `apps/manager`.
- Do not hand-edit `.next/`, generated Prisma Client, or Pothos-generated types.
- Do not introduce new direct `process.env` reads — extend `src/config/env.ts`.
