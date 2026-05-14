# CLAUDE.md — JesusFilm Forge Monorepo

## Active Freeze

> **`apps/web` UI feature work is paused on `main`** while the `feat/adapt-web-data-layer-to-admin` branch is live. Critical fixes still ship. See `docs/plans/2026-05-14-001-feat-adapt-web-data-layer-to-admin-plan.md` for scope. Rebuild branch rebases from main when critical fixes touch `apps/web/src/lib/`, `apps/web/src/app/`, shared types, or `packages/graphql/**`.

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
- `apps/mobile/` — React Native / Expo app (active development, EAS for builds)
- `apps/cms/` — Strapi v5 headless CMS with GraphQL plugin
- `apps/roadmap/` — Next.js roadmap dashboard (reads from `docs/roadmap/`)
- `packages/graphql/` — gql.tada typed GraphQL client (generated from Strapi's GraphQL schema)

## Package-Specific Instructions

When working in a specific package, also read that package's `CLAUDE.md`:

- Working in `apps/web/`? Also read `apps/web/CLAUDE.md`
- Working in `apps/cms/`? Also read `apps/cms/CLAUDE.md`
- Working in `apps/mobile/`? Also read `apps/mobile/CLAUDE.md`
- Working in `packages/graphql/`? Also read `packages/graphql/CLAUDE.md`
- Working in `apps/roadmap/`? Also read `apps/roadmap/CLAUDE.md`

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
tags:                         # Searchable: cms, manager, web, mobile, tv, graphql, ai-pipeline, search, pgvector, infrastructure, i18n
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

1. Check `docs/roadmap/` for a relevant feature ticket. If one exists, use Compound Engineering to brainstorm against that ticket before implementation.
2. Run `ce:plan` with explicit scope: "Add X, affecting `apps/web` and `packages/graphql`"
3. Reference `docs/solutions/` for past patterns relevant to the task.
4. Check `todos/` for related outstanding findings.
5. Set the roadmap feature to `status: "in-progress"` if applicable.

### The GraphQL Change Flow

`packages/graphql` is currently Strapi-only and emits the `graphql()` factory. Admin-side typed GraphQL will live in `packages/admin-graphql` — landing in U9 of the `feat/adapt-web-data-layer-to-admin` plan. The branch is mid-rebuild: U9–U10 complete the new package and re-add CI's admin codegen verification.

**Strapi-side change flow:**

1. Add or modify content type in `apps/cms/` (Strapi admin or code)
2. Run Strapi locally so the GraphQL schema is available; `apps/cms/schema.graphql` auto-emits
3. Run `pnpm --filter @forge/graphql generate` to regenerate `packages/graphql/src/graphql-env.d.ts`
4. Update or add queries/mutations/fragments using the `graphql()` factory in consuming apps
5. Update consuming code in `apps/web/`, `apps/mobile/`, `apps/tv/`
6. Commit generated files alongside source changes

**Admin-side change flow (current — until U9):**

1. Add or modify Pothos types in `apps/admin/src/graphql/types/` or related modules
2. Run `pnpm --filter @forge/admin schema:print` to regenerate `apps/admin/schema.graphql`
3. Commit both (Pothos source change + `schema.graphql`) in the same PR

No admin codegen consumer exists on this branch. Once U9 ships `packages/admin-graphql`, this section adds the codegen + consuming-code steps mirroring the Strapi flow. CI's `admin-schema-drift` job catches step 2 today; CI's admin-codegen verify returns in U10.

### Known Patterns (add to this list as you compound)

- Cloudflare + Railway: requires Authenticated Origin Pulls + DNSSEC
- Strapi v5 API token seeding: HMAC-SHA512 in bootstrap lifecycle
- EAS build profiles: environment variables differ per profile (development, preview, production)
- Railway deploy hooks: use for post-deploy migrations and health checks
- Devcontainer + pnpm: use `corepack prepare pnpm@<version> --activate` pinned to match `packageManager` in root `package.json` — see `docs/solutions/platform/devcontainer-setup.md`
- Manager backfill pattern: claim lock synchronously before `after()`, use output table as progress tracker, constrain SQL DISTINCT ON joins — see `docs/solutions/platform/backfill-worker-pattern-manager-20260407.md`
- Strapi v5 raw SQL: field names are snake-cased in DB (`bcp47` → `bcp_47`). Always verify with `\d tablename` against prod before writing raw SQL.
- PostgreSQL 18 (Railway): `?::jsonb::text[]` cast is NOT supported. Use PG array literal format (`{val1,val2}`) with `?::text[]` instead. See `apps/cms/src/api/scene-embedding/services/indexer.ts` `toPgArray()`. Bulk-write pattern with per-row Way A vector + `text[]` casts at the SELECT seam: `docs/solutions/database-issues/pgvector-bulk-insert-on-conflict-pattern-20260505.md`.
- PostgreSQL `jsonb_array_elements_text(jsonb)` ≠ `json_array_elements_text(json)`. Distinct functions, NOT overloaded across the json/jsonb seam — `json_array_elements_text(jsonb)` does NOT exist (parse error 42883). When using Way A unfold (`u.col_json::jsonb`), call `jsonb_array_elements_text`. Mocked SQL-shape tests catch clause SHAPE but NOT function-resolution; only a real-DB smoke catches this. See `docs/solutions/database-issues/pgvector-bulk-insert-on-conflict-pattern-20260505.md`.
- Mux data model: `mux_videos.duration` is always 0. Duration lives on `video_variants.duration`.
- Local embed pipeline + manager-trigger proxy: admin owns the embedding workflows + destination Postgres; manager exposes thin REST proxies at `/api/admin-embeds/{scene,transcript}` that forward to admin's GraphQL trigger mutations via a bearer key matching admin's `WORKFLOW_API_KEYS`. Local-dev path is `pnpm --filter @forge/admin pull:mapping` + `pnpm run-embeds` against any `DATABASE_URL` — see `docs/solutions/platform/local-embed-pipeline-pattern-20260429.md`.
- Cross-app trigger pattern (bidirectional): admin↔manager service-to-service triggers use a caller-side single key + receiver-side CSV asymmetry. Both directions are now wired: manager → admin (`/api/admin-embeds/*` → `triggerSceneEmbeddingBackfill`/`triggerTranscriptEmbeddingBackfill`, with admin holding the CSV `WORKFLOW_API_KEYS`) and admin → manager (`triggerManagerEnrichment` → `/api/admin-trigger/*`, with manager holding the CSV `ADMIN_TRIGGER_API_KEYS`). Receiver deploys keyring entry FIRST; then caller deploys env var. Reverse order produces a dead minute where the first call 401s. See `docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md`.
- AWS S3 NoSuchKey classification: never branch on the error MESSAGE — match `error.name === "NoSuchKey" | "NotFound"` (AWS SDK v3 typed surface) first, legacy `error.Code === "NoSuchKey" | "NotFound"` second, tightened regex `/not found|does not exist|ENOENT/i` as backstop only. Tests must throw the REAL typed shape (`Object.assign(new Error(...), { name: "NoSuchKey" })`), not generic `new Error("NoSuchKey: ...")` — otherwise the regex backstop satisfies the test while the typed branch stays untested. See `docs/solutions/runtime-errors/aws-s3-nosuchkey-classification-pattern-20260506.md`.
- Mocked-vs-real testing discipline (META): mocked tests prove BRANCH SHAPE; real fixtures prove PRODUCTION CONTRACT. Every typed-discriminator branch needs at least one test where ONLY that branch can match — otherwise deleting a branch wouldn't fail any test. Same trap shows up in AWS error shapes, PG function resolution, in-house typed errors with literal-union codes, infrastructure-write tools that return success on staged-but-not-deployed changes, AND cross-PR file-format contracts (feat-119 PR2's `kind: "scene"` vs PR1's `kind: "scene-analysis"`). See `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` for the META home + five worked instances.
- Producer-consumer report-file contract: when two stacked PRs share a file format (PR1 `--report-out` + PR2 `--from-report`), the discriminator literals (kinds, statuses) MUST align across the boundary. Pick ONE source of truth (typically the wire shape — URL paths or GraphQL enums) and align both halves to it; don't rename through layers. Test fixtures must use the producer's actual literals, not the consumer's assumptions. See `docs/solutions/best-practices/producer-consumer-report-file-contract-pattern-20260506.md`.
- Outbound timeout MUST be shorter than the upstream caller's budget: any server-route function that calls a downstream client (Apollo, pg, http) which doesn't honor an explicit per-call timeout must wrap with `Promise.race` + a typed `TimeoutError` rejection, with a budget strictly smaller than the upstream caller's ceiling. Otherwise the upstream classifier wins the race ("network_error retryable" → retry storm) while the inner call keeps running. Pick the mechanism that matches the client (`AbortSignal.timeout` for fetch; `Promise.race` for Apollo; `statement_timeout` + race for pg). See `docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md`.
- Fire-and-forget slot-leak guard: any `after()`-style or queue-style background dispatch that reserves in-memory state (idempotency map, semaphore, claim token) before dispatch must wrap the ENTIRE callback body in `try/finally` — not just the `await dispatch`. A naive `try { await dispatch } finally { delete }` leaks the slot if anything earlier in the callback (structured-log JSON.stringify, getter on a proxy, future side-effect) throws synchronously. Add a sync-throw test (not just async-reject) for every reserve/release pair. See `docs/solutions/best-practices/in-memory-slot-reservation-fire-and-forget-20260506.md`.
- Client mirrors server dedupe: when a client → server pair has the server deduping by a stable id, the client MUST mirror that dedupe by the SAME key, before the request. Otherwise request and response array lengths diverge and the client synthesizes confused outcomes (was this NOT_FOUND or just deduped?). Document the dedupe key in BOTH halves' code comments so future maintainers can't accidentally diverge them. See `docs/solutions/best-practices/client-mirror-server-dedupe-per-id-contract-20260506.md`.
- Pothos mutations — parallel arg arrays vs input-object list: default to `[InputType!]!`. Use parallel `[T1!]! + [T2!]!` arrays paired by index ONLY when ≤2 fields, the producer naturally projects them as separate arrays, AND the field set is unlikely to grow within 6 months. Length-equality validation in the resolver is a smell — input objects make it unrepresentable. See `docs/solutions/graphql/pothos-parallel-arg-arrays-vs-input-list-20260506.md`.
- Operator-actionable projections in workflow reports: when a `succeeded/skipped/failed` count triple accumulates duplicate signals via a cascade (e.g., L outcomes per missing `(parent, child)` group), surface a deduped+sorted projection by stable id (`{ assetId, coreId, kind }`) AS A FIRST-CLASS REPORT FIELD. Dedup at projection time, not in the cascade — preserves the per-target outcome contract for dashboards while giving operators an actionable unique-set view. feat-119 PR1's `missingArtifacts` field is the canonical example. See `docs/solutions/best-practices/workflow-report-operator-actionable-projection-pattern-20260506.md`.
- Opt-in scaffolding env vars must be `.optional()`: required Zod env vars with no default brick Railway deploys for environments that haven't been provisioned yet — even when the default code path never invokes the consumer. Required-at-schema-load is reserved for vars the always-on code consumes. For new opt-in scaffolding (canary flags, dual-source migration vars, dev-only debug toggles): use `.optional()` + runtime fallback so default mode has zero new env-var prerequisites. Operational mitigations like "deploy env var before PR merge" buried in plan notes are too easy to skip; move the precondition into the schema. See `docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md`.
- Tier-2 `/ce-code-review` is mandatory before push when shipping-workflow triggers fire (>=400 LOC + >3 dirs, >=1000 LOC, OR any sensitive surface — auth, payments, data migrations, security config, public API, dependency manifests). Unit tests + green CI prove what code DOES, not what it SHOULD do under adversarial conditions; Tier-2 personas (security, adversarial, reliability, correctness) construct the failure scenarios that catch design-shape bugs before push. Routing rule: when a reliability/security/correctness persona flags P2+ at confidence 75+, the default bias is Apply, not Defer — especially for new env vars, schema validation, or Apollo client construction. See `docs/solutions/workflow-issues/ce-code-review-tier-2-mandatory-before-push-20260511.md`.
