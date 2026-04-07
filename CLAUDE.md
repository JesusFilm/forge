# CLAUDE.md — JesusFilm Forge Monorepo

## Project Overview

JesusFilm (JFP) is a ministry organization. This monorepo contains our web, mobile, and CMS applications with a shared GraphQL client package.

## Architecture

```
apps/cms (Strapi v5) -> exposes GraphQL API
      ->
packages/graphql (gql.tada) -> typed client generated from Strapi schema
      ->
apps/web (Next.js)  +  apps/mobile-v2 (Expo)
```

> **`apps/mobile/` is DEPRECATED.** Never read, modify, or reference files in `apps/mobile/`. All mobile work targets `apps/mobile-v2/`. If a user says "mobile" without qualification, they mean `apps/mobile-v2/`.

All apps deploy to Railway. Cloudflare sits in front for DNS, WAF, and Authenticated Origin Pulls.

## Monorepo Structure

This is a pnpm + Turborepo monorepo.

- `apps/web/` — Next.js 16+ App Router application (`next@^16.1.6`)
- `apps/mobile/` — **DEPRECATED, DO NOT MODIFY.** Legacy Expo app replaced by `apps/mobile-v2/`.
- `apps/mobile-v2/` — React Native / Expo app (active development, EAS for builds)
- `apps/cms/` — Strapi v5 headless CMS with GraphQL plugin
- `apps/roadmap/` — Next.js roadmap dashboard (reads from `docs/roadmap/`)
- `packages/graphql/` — gql.tada typed GraphQL client (generated from Strapi's GraphQL schema)

## Package-Specific Instructions

When working in a specific package, also read that package's `CLAUDE.md`:

- Working in `apps/web/`? Also read `apps/web/CLAUDE.md`
- Working in `apps/cms/`? Also read `apps/cms/CLAUDE.md`
- Working in `apps/mobile-v2/`? Also read `apps/mobile-v2/CLAUDE.md`
- Working in `packages/graphql/`? Also read `packages/graphql/CLAUDE.md`
- Working in `apps/roadmap/`? Also read `apps/roadmap/CLAUDE.md`
- **Never work in `apps/mobile/`** — it is deprecated.

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

- This package provides the typed `graphql()` function and introspection types generated from the Strapi GraphQL schema using gql.tada.
- After any Strapi content type change: run codegen to regenerate types.
- Operations (queries, mutations, fragments) are defined in consuming apps (e.g., `apps/web/src/lib/content.ts`, `apps/manager/src/cms/`) using the `graphql()` function exported by this package.

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
- **NEVER skip pre-commit hooks (`--no-verify`).** If the hook fails, fix the underlying issue. The hook exists to prevent broken code from reaching CI.

### Environment Variables

- Local dev: `.env.local` (gitignored).
- Deployed: Railway service environment variables.
- Never hardcode secrets. Never commit `.env` files.

## Roadmap

The project roadmap lives in `docs/roadmap/` as markdown files with YAML frontmatter. A viewer app at `apps/roadmap/` renders them. The roadmap is the single source of truth for what work is planned, in progress, and complete.

### Roadmap Structure

```
docs/roadmap/
├── README.md                          # Overview and feature index
├── content-discovery/feat-*.md        # Search and discovery features
├── topic-experiences/feat-*.md        # Topic pages and AI generation
├── media-generation/feat-*.md         # Audio/video AI features
└── platform/feat-*.md                 # Infrastructure and tooling
```

### Feature File Format

Every feature file must have this frontmatter:

```yaml
---
id: "feat-NNN"                # Globally unique, sequential
title: "Short feature title"
owner: "person-name"          # tataihono, vlad, ekkasit, nisal, urim
priority: "P0"                # P0, P1, P2
status: "not-started"         # not-started, in-progress, complete, blocked
start_date: "2026-04-01"     # Expected start date (YYYY-MM-DD)
duration: 14                  # Expected number of days to implement
depends_on:                   # Feature IDs this depends on
  - "feat-001"
blocks:                       # Feature IDs this blocks
  - "feat-010"
tags:                         # Searchable: cms, manager, web, mobile, graphql, ai-pipeline, search, pgvector, infrastructure
  - "cms"
---

## Problem
(why this work is needed)

## Entry Points — Read These First
(numbered list of exact file paths and what to look for)

## Grep These
(patterns to search for in the codebase)

## What To Build
(concrete implementation with types/interfaces/code snippets)

## Constraints
(what NOT to do, explicit boundaries)

## Verification
(how to confirm the work is done — commands, queries, checks)
```

### Roadmap Rules

- **Body must be agent-optimized**: exact file paths, grep patterns, TypeScript types, verification commands. No vague descriptions.
- **Do not duplicate frontmatter in the body**: title, priority, start_date, and duration are in frontmatter only, not repeated as headings.
- **IDs are globally unique**: next ID is one higher than the highest existing `feat-NNN`.
- **Dependencies are bidirectional**: if A `depends_on` B, then B must list A in `blocks`.
- **Status is computed for blocked**: the viewer auto-marks features as blocked if any dependency is incomplete. Only set `status: "blocked"` manually for non-dependency blocks.
- **Lane is the directory**: do not add a `lane` field in frontmatter.
- **Reassigning is a one-line change**: update the `owner` field, no file moves needed.

### When To Update the Roadmap

- **Starting work on a feature**: set `status: "in-progress"`
- **Completing a feature**: set `status: "complete"`
- **New work identified during a feature**: create a new `feat-NNN` file in the appropriate lane directory
- **After `ce:brainstorm`**: if brainstorm identifies new features, add them to the roadmap
- **After `ce:compound`**: if the learning reveals follow-up work, create a ticket for it

## Compound Engineering

This repo uses the compound engineering workflow. After completing work:

1. Run `ce:compound` to capture what you learned.
2. Tag solutions with the correct category from `docs/solutions/`.
3. Update this CLAUDE.md if a new pattern should be permanent.
4. Check if the learning applies across packages — if so, document it at the root level.
5. Update the relevant roadmap feature status in `docs/roadmap/`.

### Before Starting Work

1. Check `docs/roadmap/` for a relevant feature ticket. If one exists, use `/ce:brainstorm` with it.
2. Run `ce:plan` with explicit scope: "Add X, affecting `apps/web` and `packages/graphql`"
3. Reference `docs/solutions/` for past patterns relevant to the task.
4. Check `todos/` for related outstanding findings.
5. Set the roadmap feature to `status: "in-progress"` if applicable.

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
- Manager backfill pattern: claim lock synchronously before `after()`, use output table as progress tracker, constrain SQL DISTINCT ON joins — see `docs/solutions/platform/backfill-worker-pattern-manager-20260407.md`
