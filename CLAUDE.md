# CLAUDE.md — JesusFilm Forge Monorepo

## Project Overview

JesusFilm (JFP) is a ministry organization. This monorepo contains our web, mobile, and CMS applications with a shared GraphQL client package.

## Architecture

```
apps/cms (Strapi v5) -> exposes GraphQL API
      ->
packages/graphql (gql.tada) -> typed client generated from Strapi schema
      ->
apps/web (Next.js)  +  apps/mobile (Expo)
```

All apps deploy to Railway. Cloudflare sits in front for DNS, WAF, and Authenticated Origin Pulls.

## Monorepo Structure

This is a pnpm + Turborepo monorepo.

- `apps/web/` — Next.js 16+ App Router application (`next@^16.1.6`)
- `apps/mobile/` — React Native / Expo app (EAS for builds)
- `apps/cms/` — Strapi v5 headless CMS with GraphQL plugin
- `packages/graphql/` — gql.tada typed GraphQL client (generated from Strapi's GraphQL schema)

## Package-Specific Instructions

When working in a specific package, also read that package's `CLAUDE.md`:

- Working in `apps/web/`? Also read `apps/web/CLAUDE.md`
- Working in `apps/cms/`? Also read `apps/cms/CLAUDE.md`
- Working in `apps/mobile/`? Also read `apps/mobile/CLAUDE.md`
- Working in `packages/graphql/`? Also read `packages/graphql/CLAUDE.md`

Package CLAUDE.md files contain conventions that override or extend global ones.

## Cursor Rule Loading

Cursor does not load this file automatically. Keep `.cursor/rules/project-context.mdc` present and make it reference:

- `@CLAUDE.md`
- `@AGENTS.md`

## Tech Stack Conventions

### TypeScript

- Strict mode everywhere. No `any` unless explicitly justified with a comment.
- Prefer `type` over `interface` unless declaration merging is needed.
- Use `satisfies` for type-safe object literals.

### GraphQL (packages/graphql)

- This package exists solely to provide typed GraphQL operations for apps/web and apps/mobile.
- Types are generated from the Strapi GraphQL schema using gql.tada introspection.
- After any Strapi content type change: run codegen to regenerate types.
- Operations (queries, mutations, fragments) are co-located in this package so both apps share them.

### Next.js (apps/web)

- App Router only. No Pages Router.
- Server Components by default. Add `'use client'` only when needed.
- Server Actions for mutations. No API routes unless needed for webhooks.
- Use `next/image` and `next/font` — no raw `<img>` tags.

### React Native (apps/mobile)

- Expo managed workflow. Eject only if absolutely necessary.
- EAS Build for CI/CD. Test builds with `eas build --profile preview`.
- Follow Expo Router conventions for navigation.

### Strapi (apps/cms)

- Strapi v5 with GraphQL plugin enabled.
- Content types defined in the admin UI.
- API tokens seeded via bootstrap lifecycle using HMAC-SHA512 hashing.
- GraphQL schema is the contract — apps/web and apps/mobile never call Strapi REST.

### Deployment

- Everything deploys to Railway. No Terraform, no AWS infrastructure.
- Cloudflare handles DNS, WAF rules, and Authenticated Origin Pulls in front of Railway.
- Railway services configured via `railway.toml` or dashboard.
- Environment variables managed in Railway service settings.

## Patterns and Preferences

### Error Handling

- Use typed error classes, not raw `throw new Error()`.
- GraphQL errors surfaced through gql.tada's typed error handling.

### Testing

- Colocate tests: `Component.test.tsx` next to `Component.tsx`.
- Use `vitest` for unit tests, Playwright for e2e.
- Test behaviour, not implementation.

### Git

- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`.
- Branch naming: `feat/description`, `fix/description`, `chore/description`, `docs/description`.
- PRs should target `main`. Squash merge.

### Environment Variables

- Local dev: `.env.local` (gitignored).
- Deployed: Railway service environment variables.
- Never hardcode secrets. Never commit `.env` files.

## Compound Engineering

This repo uses the compound engineering workflow. After completing work:

1. Run `ce:compound` to capture what you learned.
2. Tag solutions with the correct category from `docs/solutions/`.
3. Update this CLAUDE.md if a new pattern should be permanent.
4. Check if the learning applies across packages — if so, document it at the root level.

### Before Starting Work

1. Run `ce:plan` with explicit scope: "Add X, affecting `apps/web` and `packages/graphql`"
2. Reference `docs/solutions/` for past patterns relevant to the task.
3. Check `todos/` for related outstanding findings.

### The GraphQL Change Flow

This is the most common cross-package workflow. Every agent should know it:

1. Add or modify content type in `apps/cms/` (Strapi admin or code)
2. Run Strapi locally so the GraphQL schema is available
3. Run codegen in `packages/graphql/` to regenerate typed operations
4. Update or add queries/mutations/fragments in `packages/graphql/`
5. Update consuming code in `apps/web/` and/or `apps/mobile/`
6. Commit generated files alongside source changes

Never skip step 3. Stale types are the #1 source of runtime GraphQL errors.

### Known Patterns (add to this list as you compound)

- Cloudflare + Railway: requires Authenticated Origin Pulls + DNSSEC
- Strapi v5 API token seeding: HMAC-SHA512 in bootstrap lifecycle
- EAS build profiles: environment variables differ per profile (development, preview, production)
- Railway deploy hooks: use for post-deploy migrations and health checks
- Devcontainer + pnpm: use `corepack prepare pnpm@<version> --activate` pinned to match `packageManager` in root `package.json` — see `docs/solutions/platform/devcontainer-setup.md`
