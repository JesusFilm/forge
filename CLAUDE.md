# CLAUDE.md — JesusFilm Forge Monorepo

## Project Overview

JesusFilm (JFP) is a ministry organization. This monorepo contains our web, mobile, TV, admin, and manager applications with a shared admin GraphQL client package.

## Architecture

```
apps/admin (Next.js + Pothos + Prisma) -> exposes GraphQL API
      ->
packages/admin-graphql (gql.tada) -> typed client generated from admin SDL
      ->
apps/web (Next.js) + apps/mobile (Expo) + apps/tv (React Native TV)
```

The public consumer data layer uses admin GraphQL. The old Strapi CMS app and Strapi-bound `packages/graphql` client have been removed.

All apps deploy to Railway. Cloudflare sits in front for DNS, WAF, and Authenticated Origin Pulls.

## Monorepo Structure

This is a pnpm + Turborepo monorepo.

- `apps/web/` — Next.js 16+ App Router application (`next@^16.1.6`); reads from admin via `packages/admin-graphql`
- `apps/admin/` — Next.js + Pothos + Prisma + pgvector; web's data source post-U22
- `apps/mobile/` — React Native / Expo app (active development, EAS for builds); reads from admin via `packages/admin-graphql`
- `apps/tv/` — React Native TV app; reads from admin via `packages/admin-graphql`
- `apps/roadmap/` — Next.js roadmap dashboard (reads from `docs/roadmap/`)
- `apps/chat/` — Next.js chat UI for the `apps/mastra` Seeker agent; replies stream from Seeker behind the `SEEKER_CHAT_ENABLED` kill switch composed with the per-user seeker dogfood email allowlist (`SEEKER_ALLOWED_EMAILS` env CSV, feat-233/feat-239), stub otherwise
- `packages/admin-graphql/` — gql.tada typed GraphQL client (generated from admin's `schema.graphql`); consumed by web
- `CONCEPTS.md` (repo root) — shared domain vocabulary (entities like Video, Dub, Video Edition); relevant when orienting to the codebase or discussing domain concepts

## Package-Specific Instructions

When working in a specific package, also read that package's `CLAUDE.md`:

- Working in `apps/web/`? Also read `apps/web/CLAUDE.md`
- Working in `apps/admin/`? Also read `apps/admin/CLAUDE.md`
- Working in `apps/mobile/`? Also read `apps/mobile/CLAUDE.md`
- Working in `apps/tv/`? Also read `apps/tv/CLAUDE.md`
- Working in `packages/admin-graphql/`? Also read `packages/admin-graphql/CLAUDE.md`
- Working in `apps/roadmap/`? Also read `apps/roadmap/CLAUDE.md`
- Working in `apps/chat/`? Also read `apps/chat/CLAUDE.md`

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

### GraphQL — typed client

Consumers use `@forge/admin-graphql` (admin's GraphQL surface). The package owns its gql.tada introspection and codegen artifact.

- `packages/admin-graphql` exposes `adminGraphql()` + `AdminFragmentOf`/`AdminResultOf`/`AdminVariablesOf` type aliases + `readFragment`. SDL-only consumption — never imports from `apps/admin/src/domain/*` at runtime (sidesteps the tsx-ESM trap).
- Operations (queries, mutations, fragments) are defined in the consuming apps, never in the client packages. Web's operations live in `apps/web/src/lib/content.ts`, `search.ts`, `recommendations.ts`, `demo-search.ts`, and the fragment files in `apps/web/src/lib/fragments/`. The shared `WatchExperience` root composition is re-exported from `@forge/admin-graphql/fragments`.
- After any schema change on EITHER side: run that package's codegen to regenerate the introspection `.d.ts`. CI has separate drift jobs (`graphql-generate`, `admin-graphql-generate`, `admin-schema-drift`) that fail if you forget.

### Next.js (apps/web)

- App Router only. No Pages Router.
- Server Components by default. Add `'use client'` only when needed.
- Server Actions for mutations. No API routes unless needed for webhooks.
- Use `next/image` and `next/font` — no raw `<img>` tags.

### React Native (apps/mobile)

- Expo managed workflow. Eject only if absolutely necessary.
- EAS Build for CI/CD. Test builds with `eas build --profile preview`.
- Follow Expo Router conventions for navigation.

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
├── platform/feat-*.md                 # Infrastructure and tooling
└── ai-chat/feat-*.md                  # Jesus Film AI Chat — docs-only lane, NOT rendered by the viewer
```

> **`ai-chat` is a docs-only lane.** Unlike the others it is intentionally **not** registered in the viewer app (`apps/roadmap`) and its tickets are **not** counted in the generated root `README.md`. If you are adding or modifying a ticket in the `ai-chat` lane, read `docs/roadmap/ai-chat/CLAUDE.md` first — it carries that lane's own conventions (README upkeep, ID allocation, status handling).

### Feature File Format

Every feature file must have this frontmatter:

```yaml
---
id: "feat-NNN"                # Globally unique, sequential
title: "Short feature title"
owner: "person-name"          # tataihono, vlad, ekkasit, nisal, urim, jian wei, jaco
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
2. Run `ce:plan` with explicit scope: "Add X, affecting `apps/web` and `packages/admin-graphql`"
3. Reference `docs/solutions/` for past patterns relevant to the task.
4. Check `todos/` for related outstanding findings.
5. Set the roadmap feature to `status: "in-progress"` if applicable.

### The GraphQL Change Flow

Two parallel flows since web migrated to admin. Both follow the same pattern: schema artifact emits → codegen regenerates introspection → consuming code updates → all committed together.

**Admin-side change flow (web's data source):**

1. Add or modify Pothos types in `apps/admin/src/graphql/types/` or related modules
2. Run `pnpm --filter @forge/admin schema:print` to regenerate `apps/admin/schema.graphql`
3. Run `pnpm --filter @forge/admin-graphql generate` to regenerate `packages/admin-graphql/src/admin-graphql-env.d.ts`
4. Update or add queries/mutations/fragments using `adminGraphql()` from `@forge/admin-graphql` in `apps/web/src/lib/`
5. Update consuming code in `apps/web/`
6. Commit all three generated artifacts (Pothos source + `schema.graphql` + `admin-graphql-env.d.ts`) alongside source changes

CI's `admin-schema-drift` catches step 2, `admin-graphql-generate` catches step 3.

**Cross-app ISR refresh:** admin emits ISR revalidation webhooks to web on Experience publish / update / archive via `apps/admin/src/services/revalidate-webhook.ts`. Best-effort; never blocks admin's editor UX. See `apps/admin/CLAUDE.md` "Web ISR revalidation webhook (U21)" for deploy ordering.

### Known Patterns (add to this list as you compound)

- Cloudflare + Railway: requires Authenticated Origin Pulls + DNSSEC
- EAS build profiles: environment variables differ per profile (development, preview, production)
- Railway deploy hooks: use for post-deploy migrations and health checks
- Devcontainer + pnpm: use `corepack prepare pnpm@<version> --activate` pinned to match `packageManager` in root `package.json` — see `docs/solutions/platform/devcontainer-setup.md`
- Manager backfill pattern: claim lock synchronously before `after()`, use output table as progress tracker, constrain SQL DISTINCT ON joins — see `docs/solutions/platform/backfill-worker-pattern-manager-20260407.md`
- PostgreSQL `jsonb_array_elements_text(jsonb)` ≠ `json_array_elements_text(json)`. Distinct functions, NOT overloaded across the json/jsonb seam — `json_array_elements_text(jsonb)` does NOT exist (parse error 42883). When using Way A unfold (`u.col_json::jsonb`), call `jsonb_array_elements_text`. Mocked SQL-shape tests catch clause SHAPE but NOT function-resolution; only a real-DB smoke catches this. See `docs/solutions/database-issues/pgvector-bulk-insert-on-conflict-pattern-20260505.md`.
- Mux data model: `mux_videos.duration` is always 0. Duration lives on `video_variants.duration`.
- Local embed pipeline + manager-trigger proxy: admin owns the active transcript/experience embedding workflows + destination Postgres; manager exposes the thin REST proxy at `/api/admin-embeds/transcript` that forwards to admin's `triggerTranscriptEmbeddingBackfill` mutation via a bearer key matching admin's `WORKFLOW_API_KEYS`. The legacy scene proxy remains only as a 410 tombstone. Local-dev path is `pnpm --filter @forge/admin pull:mapping` + `pnpm run-embeds` against any `DATABASE_URL` — see `docs/solutions/platform/local-embed-pipeline-pattern-20260429.md`.
- Cross-app trigger pattern (bidirectional): admin↔manager service-to-service triggers use a caller-side single key + receiver-side CSV asymmetry. Active directions are manager → admin (`/api/admin-embeds/transcript` → `triggerTranscriptEmbeddingBackfill`, with admin holding the CSV `WORKFLOW_API_KEYS`) and admin → manager (`triggerManagerEnrichment` → `/api/admin-trigger/*`, with manager holding the CSV `ADMIN_TRIGGER_API_KEYS`). Receiver deploys keyring entry FIRST; then caller deploys env var. Reverse order produces a dead minute where the first call 401s. See `docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md`.
- Search API authentication (`/api/search` + `Query.search`): bearer-as-passport pattern. Admin reads `Authorization: Bearer <k>` against `isAnyKnownBearer()` which OR-composes three known-caller branches — DB-backed PARTNER (Plan 003 `PartnerApiKey` table; runs FIRST so `keyId` threads into logs), CONSUMER (`WEB_ADMIN_API_KEYS` env CSV — apps/web SSR), and WORKFLOW (`WORKFLOW_API_KEYS` env CSV — workflow-trigger). The boot-time `assertBearerCsvsDisjoint` invariant guarantees each env-CSV key value lives in exactly one CSV. Rate-limit (per-IP, 30/min) fires BEFORE the auth check so junk bearers can't bypass the bucket. Phased dual-accept → required-auth via `SEARCH_AUTH_REQUIRED` env flag. The legacy `SEARCH_API_KEYS` env-CSV partner branch was retired in Plan 003. See `apps/admin/CLAUDE.md` "Search API authentication" + `docs/plans/2026-05-17-002-feat-search-api-auth-plan.md` + `docs/solutions/architecture-patterns/bearer-as-passport-multi-csv-composition-20260518.md`.
- Partner API key store (DB-backed): `/api/search` partner credentials live in admin's `PartnerApiKey` Postgres table (NOT env-CSV) so they get per-key audit, sub-second revocation, and metadata that internal env-CSV bearers don't need. Token shape `jfp_search_<keyId>_<random>`; stored hash is `sha256(rawToken)`. The composer's PARTNER branch runs FIRST and threads `source=partner keyId=<id>` into the per-request log so operators can answer "which partners called this week" from logs alone. Hot-path Prisma lookup wrapped in `Promise.race` against a 1500ms budget; `lastUsedAt` updates fire-and-forget. Internal bearer CSVs (`WORKFLOW_API_KEYS`, `WEB_ADMIN_API_KEYS`, `BACKUP_DOWNLOAD_API_KEYS`) stay on env CSV — different threat model, different operator pattern. CLI: `pnpm --filter @forge/admin partner-keys <create|list|revoke|rotate>`; read-only dashboard at `/dashboard/partner-keys`. Legacy migration path is rotate-onto-fresh-token (no in-place import); see `apps/admin/CLAUDE.md` "Partner API key store" + `docs/plans/2026-05-18-001-feat-partner-api-key-store-plan.md`.
- WAF passthrough verification via prior art: when verifying that Cloudflare doesn't strip `Authorization` (or any header) on a new endpoint, the empirical shortcut is "is something with the same shape ALREADY working in production?" If a sibling surface on the same domain/path-prefix has been using the header successfully for weeks (apps/web SSR's consumer-bearer to admin since 2026-05-13; manager → admin workflow-trigger since 2026-04-29), the new surface inherits identical passthrough. Skips the fresh-probe + origin-log dance entirely. See `docs/solutions/best-practices/waf-passthrough-verification-via-prior-art-20260518.md`.
- Railway logsV2 silences JSON-stringified payloads from Next.js App Router runtime route handlers (Next.js 16 + Node 24 + standalone + logsV2:true), regardless of `console.log` / `console.warn` / `console.error`. The same `console.error` from the same file surfaces fine when the payload is plain-string but is dropped when it's `JSON.stringify(...)`. **Default rule for admin's request path:** use the `[label] event=name key=value key=value` plain-string format (matching the existing `event=query_embedding_failure` log convention), NOT `JSON.stringify`. PRs #970 + #972 attempted console-method swaps and verified that approach is wrong; PR #973 corrects to plain-string format. See `docs/solutions/runtime-errors/railway-logsv2-silences-nextjs-stdout-runtime-20260518.md`.
- AWS S3 NoSuchKey classification: never branch on the error MESSAGE — match `error.name === "NoSuchKey" | "NotFound"` (AWS SDK v3 typed surface) first, legacy `error.Code === "NoSuchKey" | "NotFound"` second, tightened regex `/not found|does not exist|ENOENT/i` as backstop only. Tests must throw the REAL typed shape (`Object.assign(new Error(...), { name: "NoSuchKey" })`), not generic `new Error("NoSuchKey: ...")` — otherwise the regex backstop satisfies the test while the typed branch stays untested. See `docs/solutions/runtime-errors/aws-s3-nosuchkey-classification-pattern-20260506.md`.
- Mocked-vs-real testing discipline (META): mocked tests prove BRANCH SHAPE; real fixtures prove PRODUCTION CONTRACT. Every typed-discriminator branch needs at least one test where ONLY that branch can match — otherwise deleting a branch wouldn't fail any test. Same trap shows up in AWS error shapes, PG function resolution, in-house typed errors with literal-union codes, infrastructure-write tools that return success on staged-but-not-deployed changes, cross-PR file-format contracts (feat-119 PR2's `kind: "scene"` vs PR1's `kind: "scene-analysis"`), AND idempotence property tests on state-machine canonicalizers that pass vacuously when malformed inputs are their own fixed point (forge#1049 `/watch` Rule 4 episode-bare contract — augment with output-shape contract assertions). See `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` for the META home + eight worked instances.
- Producer-consumer report-file contract: when two stacked PRs share a file format (PR1 `--report-out` + PR2 `--from-report`), the discriminator literals (kinds, statuses) MUST align across the boundary. Pick ONE source of truth (typically the wire shape — URL paths or GraphQL enums) and align both halves to it; don't rename through layers. Test fixtures must use the producer's actual literals, not the consumer's assumptions. See `docs/solutions/best-practices/producer-consumer-report-file-contract-pattern-20260506.md`.
- Outbound timeout MUST be shorter than the upstream caller's budget: any server-route function that calls a downstream client (Apollo, pg, http) which doesn't honor an explicit per-call timeout must wrap with `Promise.race` + a typed `TimeoutError` rejection, with a budget strictly smaller than the upstream caller's ceiling. Otherwise the upstream classifier wins the race ("network_error retryable" → retry storm) while the inner call keeps running. Pick the mechanism that matches the client (`AbortSignal.timeout` for fetch; `Promise.race` for Apollo; `statement_timeout` + race for pg). See `docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md`.
- Mastra model-entry timeout+retry envelope (refines the outbound-timeout law above for `@mastra/core` model arrays): the per-entry retry loop (p-retry) retries ANY non-APICallError — including the `TimeoutError` a custom fetch's `AbortSignal.timeout` throws — so a fetch-timeout guard on a model entry MUST pair with `maxRetries: 0` (the fallback chain IS the retry) or budget `(maxRetries+1)×timeout` retry-aware. And `AbortSignal.timeout` bounds the ENTIRE streamed body (not time-to-first-byte): a whole-stream cap chops healthy slow streams, and a mid-stream abort leaks already-emitted tokens before the fallback re-generates into the same stream. Test the abort MECHANISM via an exported factory + captured-signal stub with tiny real budgets (fake timers can't intercept `AbortSignal.timeout`), plus a budget-invariant test reading `maxRetries` from the real entry. See `docs/solutions/best-practices/mastra-model-entry-timeout-retry-and-stream-abort-pattern.md` + `docs/solutions/conventions/mastra-inline-gateway-construction-createrequire.md`.
- Byte-cap buffered upstream HTTP reads to guard a shared process from OOM (space-axis sibling of the outbound-timeout guard above): any client doing `await response.json()`/`.text()`/`.arrayBuffer()` buffers the WHOLE body into the heap before any slicing, so a misbehaving (not necessarily hostile) upstream returning a multi-GB body can OOM the single Node process that runs every Mastra agent/workflow. Stream `response.body` with a byte counter and `await reader.cancel()` (ABORT the socket, don't just stop reading) the instant it crosses a max-bytes ceiling — don't trust `Content-Length` — mapping over-cap to the client's EXISTING graceful-failure path (`undefined` → `parse_error` → `unavailable`), never a throw or a new branch. Make the no-throw boundary structural (acquire the reader inside `try`, guard `releaseLock()` in `finally`) and NEVER log the caught error (a `JSON.parse` SyntaxError can embed raw body fragments — a leak). Apply at EVERY buffering read incl. the error path; size the default above a contract-derived legit payload (low single-digit MB); keep the env knob `.optional()`. Test the abort MECHANISM (real `ReadableStream` whose `cancel()` sets a flag), not just the return value. See `docs/solutions/best-practices/buffered-http-response-byte-cap-oom-guard-20260629.md`.
- Fire-and-forget slot-leak guard: any `after()`-style or queue-style background dispatch that reserves in-memory state (idempotency map, semaphore, claim token) before dispatch must wrap the ENTIRE callback body in `try/finally` — not just the `await dispatch`. A naive `try { await dispatch } finally { delete }` leaks the slot if anything earlier in the callback (structured-log JSON.stringify, getter on a proxy, future side-effect) throws synchronously. Add a sync-throw test (not just async-reject) for every reserve/release pair. See `docs/solutions/best-practices/in-memory-slot-reservation-fire-and-forget-20260506.md`.
- Client mirrors server dedupe: when a client → server pair has the server deduping by a stable id, the client MUST mirror that dedupe by the SAME key, before the request. Otherwise request and response array lengths diverge and the client synthesizes confused outcomes (was this NOT_FOUND or just deduped?). Document the dedupe key in BOTH halves' code comments so future maintainers can't accidentally diverge them. See `docs/solutions/best-practices/client-mirror-server-dedupe-per-id-contract-20260506.md`.
- Pothos mutations — parallel arg arrays vs input-object list: default to `[InputType!]!`. Use parallel `[T1!]! + [T2!]!` arrays paired by index ONLY when ≤2 fields, the producer naturally projects them as separate arrays, AND the field set is unlikely to grow within 6 months. Length-equality validation in the resolver is a smell — input objects make it unrepresentable. See `docs/solutions/graphql/pothos-parallel-arg-arrays-vs-input-list-20260506.md`.
- Operator-actionable projections in workflow reports: when a `succeeded/skipped/failed` count triple accumulates duplicate signals via a cascade (e.g., L outcomes per missing `(parent, child)` group), surface a deduped+sorted projection by stable id (`{ assetId, coreId, kind }`) AS A FIRST-CLASS REPORT FIELD. Dedup at projection time, not in the cascade — preserves the per-target outcome contract for dashboards while giving operators an actionable unique-set view. feat-119 PR1's `missingArtifacts` field is the canonical example. See `docs/solutions/best-practices/workflow-report-operator-actionable-projection-pattern-20260506.md`.
- Opt-in scaffolding env vars must be `.optional()`: required Zod env vars with no default brick Railway deploys for environments that haven't been provisioned yet — even when the default code path never invokes the consumer. Required-at-schema-load is reserved for vars the always-on code consumes. For new opt-in scaffolding (canary flags, dual-source migration vars, dev-only debug toggles): use `.optional()` + runtime fallback so default mode has zero new env-var prerequisites. Operational mitigations like "deploy env var before PR merge" buried in plan notes are too easy to skip; move the precondition into the schema. See `docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md`.
- Tier-2 `/ce-code-review` is mandatory before push when shipping-workflow triggers fire (>=400 LOC + >3 dirs, >=1000 LOC, OR any sensitive surface — auth, payments, data migrations, security config, public API, dependency manifests). Unit tests + green CI prove what code DOES, not what it SHOULD do under adversarial conditions; Tier-2 personas (security, adversarial, reliability, correctness) construct the failure scenarios that catch design-shape bugs before push. Routing rule: when a reliability/security/correctness persona flags P2+ at confidence 75+, the default bias is Apply, not Defer — especially for new env vars, schema validation, or Apollo client construction. See `docs/solutions/workflow-issues/ce-code-review-tier-2-mandatory-before-push-20260511.md`.
- base-ui Dialog open/close verification (Chrome MCP / Playwright): `!!document.querySelector(...)` returns truthy during the close animation because base-ui keeps the Popup mounted with a `data-closed` attribute during the ~100ms transition before unmounting. For browser-driven smoke tests of any `apps/web` Dialog (`DownloadModal`, `LanguagePickerModal`, `ShareModal`, any wrapper of `src/components/ui/dialog.tsx`), inspect `data-open` / `data-closed` attributes — not element presence. Adjacent gotcha: JS-simulated clicks on base-ui Buttons can fail silently under claude-in-chrome MCP; verify the click landed via state inspection before blaming `data-open` semantics. See `docs/solutions/best-practices/base-ui-dialog-state-attribute-detection-20260520.md`.
- Heavy AI+media feature decomposition (Smart Crop, feat-173): when a PRD assigns end-to-end pipeline ownership to Mastra, split instead — durable control loop in manager (`workflow` SDK + JobRecord with an `options.<feature>` discriminator, zero admin schema changes), bounded synchronous AI decision routes in mastra (manager chunks unbounded work into ≤120s calls; frames as host-allowlisted https URLs), bytes in a dedicated plain-node worker that manager POLLS (no inbound callbacks). Day-one hardening that review otherwise forces: record-before-poll idempotency for external resource creation (persist the Mux asset id BEFORE readiness polling), checkpoint chunked AI work with provenance, skip paths parse + provenance-check artifacts (not just `artifactExists`), deterministic step failures throw the workflow SDK's `FatalError`, config-shaped upstream failures degrade advisory steps to skipped instead of failing jobs, worker dedupe key excludes the caller's job id, worker per-job deadlines strictly below manager poll ceilings, ffmpeg `-protocol_whitelist` on attacker-influenceable inputs, and a real-binary smoke (synthetic lavfi video) because mocked argv tests don't prove ffmpeg accepts the argv. See `docs/solutions/architecture-patterns/smart-crop-three-app-decomposition-20260610.md`.
- Shorts Studio (feat-178) extends the smart-crop worker law to Remotion: bake the Remotion bundle + whisper model + chrome-headless-shell into Docker BUILD layers (never runtime; pin-only layers ordered before source copy so code deploys don't reship the ~1.6GB model), keep the compositions package's pure subpaths (`/schema` `/captions` `/registry`) as manager's ONLY server imports (Player root only inside `next/dynamic` ssr:false), pin `remotion`/`@remotion/*` EXACT across all manifests (version-lockstep test — Remotion throws at render time on drift, in production not CI), prefer workspace-symlink prod install over `pnpm deploy` for source-shipped TS packages (Node refuses type-stripping under node_modules; Node >=22.18 required), and stream large media through a Range-capable route — never the buffering artifact route (outputs are 180–360MB). See `docs/plans/2026-06-11-002-feat-manager-shorts-studio-plan.md` + `apps/shorts-worker/CLAUDE.md`.
- Re-renderable durable jobs (one JobRecord, many renders — Shorts Studio) break two single-shot smart-crop patterns: record-before-poll output records must carry output provenance (`propsHash`) or a re-render silently reuses the stale Mux asset while the artifact download serves the new one; and report writes must be field-level patches merged INSIDE the per-job lock (pre-lock snapshots carried across await points revert phases and clobber interim writes — `mergeShortsReportEntry` pattern). Also gate persistent render-reuse on toolchain provenance (`compositionsVersion`), and `pnpm patchedDependencies` requires `COPY patches patches` in every Docker install stage regardless of `--filter`. See `docs/solutions/architecture-patterns/re-renderable-jobs-output-provenance-and-locked-report-merge-20260611.md` + `docs/solutions/build-errors/pnpm-patched-dependencies-filtered-docker-install-20260611.md`.
- Datadog Mobile RUM on tvOS (react-native-tvos): `@datadog/mobile-react-native@3.5.2` ships two unguarded `DatadogWebViewTracking` refs that break the tvOS build — fixed via committed pnpm patch (the repo's established tvOS-native-fix pattern; version-pinned, re-create on SDK bump — pnpm only WARNS on a stale patch key). After `pnpm patch-commit` the virtual-store path gains `patch_hash=`, so `pod install` MUST re-run (plus Xcode 26 DerivedData clear) or the identical error persists at the same line. The `expo-datadog` config plugin is deliberately excluded (its dSYM phase hard-fails without `DATADOG_API_KEY` even in Debug; its datadog-ci path assumes hoisted node_modules — broken under pnpm). See `docs/solutions/integration-issues/datadog-mobile-rum-tvos-integration.md` + `apps/tv/CLAUDE.md` Observability.
- Fail-closed-by-construction feature-flag gating (feat-233 chat seeker dogfood gate; that exemplar has since moved to the feat-239 `SEEKER_ALLOWED_EMAILS` env allowlist — the pattern remains the recipe for any future LD-gated sensitive path, and `booleanVariationDetail` + its suite remain in `@forge/feature-flags`): when a boolean flag gates a paid/sensitive upstream and the safe default is DENY, make fail-closed a property of the wiring, not operator discipline — an outcome-preserving `booleanVariationDetail` returning `{ value, source }` (so `ld_unavailable` is distinguishable from `not_targeted`), route `reason.kind === "ERROR"` resolutions to the fallback BEFORE the value check (honest attribution — the false default, not the ordering, is what prevents a grant), withhold the local override from the deployed client (`localEnv` only when `NODE_ENV === "development"`, which Next.js build-pins to production), and wrap the WHOLE flag-client path INCLUDING construction/init so the gate never throws into a catch-less SSE stream or an `error.tsx`-less RSC page. The five pieces close the FALLBACK side only — the flag's own LaunchDarkly dashboard config (off-variation, targeting rules, rollout) stays a grant surface governed by the zero-targeting-rules invariant + restricted write group, NOT the code. See `docs/solutions/architecture-patterns/fail-closed-by-construction-feature-flag-gate-20260708.md`.
- Removal-recipe ticket for phase-scoped scaffolding (feat-233 → feat-236): when you ship scaffolding meant to be torn down at a known trigger (dogfood/canary flag, migration shim, temporary compat layer), write its removal ticket IN THE SAME PR while the map is fresh — a binding KEEP-list of the permanent infra a naive `git revert` would wrongly delete (the shared `booleanVariationDetail`, the additive `emailVerified` claim threading, the kept kill switch), drift-resistant grep patterns + conditionals instead of `file:line` (the code moves during the phase — add a rename covenant so a renamed symbol updates the patterns same-PR), a precondition-first step 0 (e.g. a per-caller rate cap before public removal), and an operator/dashboard-teardown category no merged PR can claim. See `docs/solutions/workflow-issues/removal-recipe-ticket-for-phase-scoped-scaffolding-20260708.md`.
