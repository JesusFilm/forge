---
id: "feat-026"
title: "GraphQL Pipeline (Contract-First Typed Client)"
owner: "tataihono"
priority: "P0"
status: "complete"
start_date: "2026-02-12"
duration: 47
depends_on:
  - "feat-022"
blocks:
  - "feat-023"
  - "feat-024"
  - "feat-025"
  - "feat-034"
tags:
  - "graphql"
---

## Problem

All front-end apps (web, mobile, manager) need type-safe access to CMS data. A contract-first GraphQL architecture ensures type safety across the monorepo — the CMS schema is the single source of truth, and consuming apps get compile-time guarantees.

## Entry Points — Read These First

1. `packages/graphql/` — the shared typed GraphQL client package
2. `packages/graphql/src/graphql.ts` — the `graphql()` function exported for consuming apps
3. `packages/graphql/src/graphql-env.d.ts` — generated introspection types from Strapi schema
4. `apps/cms/schema.graphql` — the source schema that codegen reads from
5. `apps/web/src/lib/content.ts` — example consumer: how web defines typed queries

## Grep These

- `graphql(` in `apps/web/src/` — typed query definitions in web app
- `graphql(` in `apps/mobile/src/` — typed query definitions in mobile app
- `from "@forge/graphql"` in `apps/` — package consumption across apps
- `gql.tada` in `packages/graphql/` — codegen configuration

## What Was Built

1. Created `packages/graphql` with gql.tada for type generation from Strapi's GraphQL schema.
2. Established the contract-first workflow: CMS schema → codegen → typed client → consuming apps.
3. Consolidated from earlier `packages/contracts` and `packages/client` into a single `packages/graphql` package.
4. Expanded the `watchExperience` query to cover all 12 section types with proper fragment typing.
5. Patched codegen AST to restore optional variable definitions for Strapi v5 compatibility.
6. Set up automatic type regeneration workflow for content type changes.

## Verification

- `ls packages/graphql/src/` — graphql.ts and graphql-env.d.ts exist
- `cd packages/graphql && pnpm build` — package builds without errors
- Type imports from `@forge/graphql` resolve correctly in consuming apps
