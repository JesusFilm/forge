---
id: "feat-200"
title: "Chat app scaffold with stubbed agent"
owner: "jian wei"
priority: "P1"
status: "complete"
start_date: "2026-06-10"
duration: 3
depends_on: []
blocks:
  - "feat-201"
tags:
  - "infrastructure"
---

## Resolution

**Shipped:** 2026-06-18 via [PR #1276](https://github.com/JesusFilm/forge/pull/1276) — the scaffold originally landed through [PR #1198](https://github.com/JesusFilm/forge/pull/1198), squash-merged into the #1276 trunk.

**What landed.** `apps/chat` (`@forge/chat`) scaffolded as a Next.js App Router app on port 3200: a hybrid template (roadmap-minimal dependency footprint, `apps/web`'s CI-proven eslint/tsconfig/vitest), a single client-side chat page whose replies come from a pure stub seam (`src/lib/chat-stub.ts` — no network, no persistence, resets on refresh), full app docs (`README.md`/`CLAUDE.md`/`AGENTS.md`), and a `railway.toml` (railpack builder, port 3200, `HOSTNAME=0.0.0.0`). Registered in root `CLAUDE.md` + `AGENTS.md`. The `@forge/`-scoped name is load-bearing: an unscoped name silently misses the CI affected-filter.

**Compound docs.** `docs/solutions/platform/adding-new-apps.md`; `docs/solutions/workflow-issues/new-app-package-name-must-be-forge-scoped-for-ci.md`. Requirements: `docs/brainstorms/2026-06-10-chat-app-scaffold-requirements.md`.

**Unblocked.** feat-201 (Vigil re-skin + conversation shell).

## Problem

A chat UI for the Mastra agents in `apps/mastra` needs a home, but the agent
integration, auth, and persistence decisions aren't ready yet. Scaffold a new
`apps/chat` frontend app now — single chat page, client-side stubbed replies,
full docs, Railway deployment config — so the UI shell, conventions, and
deploy path exist before any real wiring.

## Entry Points - Read These First

1. `docs/brainstorms/2026-06-10-chat-app-scaffold-requirements.md` - full
   requirements (R1-R14) and scope boundaries.
2. `apps/web/eslint.config.mjs`, `apps/web/tsconfig.json`,
   `apps/web/vitest.config.ts`, `apps/web/package.json` (scripts block) - the
   CI-proven engineering config to model. The eslint config extends the root
   `eslint.config.mjs` + `eslint-config-next/core-web-vitals`; do the same.
   Do NOT copy web's app-specific layers (i18n, Apollo, feature flags).
3. `apps/roadmap/package.json` - the footprint to match (dependency count,
   minimal next.config), and `apps/roadmap/railway.toml` - the live
   config-as-code Railway pattern (railpack builder, watchPatterns,
   corepack-pinned pnpm in buildCommand). Do NOT copy roadmap's lint/tsconfig:
   it has no ESLint config file and no typecheck script, and never runs in CI.
4. `apps/roadmap/CLAUDE.md` - size and shape target for the new app's CLAUDE.md.
5. `apps/web/AGENTS.md` - pointer-style AGENTS.md shape to follow.
6. `apps/admin/railway.toml` - cautionary dead-config example: the service
   never reads this file. The new README must include service-wiring
   verification steps.

## Grep These

```bash
rg -n "railpack|watchPatterns" apps/*/railway.toml
rg -n '"dev".*--?p(ort)? 3' apps/*/package.json   # port collisions; chat uses 3200
rg -n "apps/chat|@forge/chat" CLAUDE.md AGENTS.md docs/
```

## What To Build

1. Create `apps/chat` as a pnpm workspace app named `@forge/chat`: Next.js
   App Router, strict TypeScript, Tailwind v4, dev port 3200. Hybrid
   template: roadmap-minimal dependency footprint; engineering config from
   `apps/web` (eslint.config.mjs extending the root config, strict `src/`
   tsconfig with ES2022 + `allowJs: false`, web's current dependency
   versions). Standard `dev`/`build`/`start`/`lint`/`typecheck` scripts so
   turbo-driven CI picks it up with no CI changes.
2. Build a single full-screen chat page: message history, text input, send.
   Assistant replies come from a pure client-side stub - no API route, no
   network calls, state resets on refresh. Replies must be recognizably
   stubbed. Interaction states: empty history shows a centered placeholder
   prompt; the stub simulates a brief reply delay with a visible pending
   indicator; input and send are disabled while a reply is pending.
3. Write `apps/chat/README.md` (what it is, local dev, Railway service setup
   checklist), `apps/chat/CLAUDE.md` (what this is, eventual `apps/mastra`
   connection stated as path-undecided - direct vs via `apps/mastra-gateway` -
   intentionally-absent list, conventions, a Development section
   with local commands such as `pnpm --filter @forge/chat dev`, deployment), and
   `apps/chat/AGENTS.md` (scope boundary + stub-only guardrail: no real
   agents, auth, or database without a roadmap ticket).
4. Add `apps/chat/railway.toml` modeled on `apps/roadmap/railway.toml`:
   railpack builder, `pnpm --filter @forge/chat build`, `watchPatterns`
   scoped to `apps/chat/**`, start on `${PORT:-3200}` with
   `HOSTNAME=0.0.0.0`.
5. Register the app in root `CLAUDE.md` (Monorepo Structure list +
   Package-Specific Instructions section) and root `AGENTS.md` (follow its
   existing per-app registration pattern).

## Constraints

- Do not add API routes, server actions, streaming, or any Mastra/agent
  connection - the stub lives entirely in client state.
- Do not add auth, a database, or conversation persistence.
- Do not add a conversation sidebar or multi-conversation shell.
- Do not import from other apps; no app may import from `apps/chat`.
- Do not assume the `railway.toml` applies automatically - the README
  checklist must cover wiring the Railway service to the file and verifying
  the deployment record's `configFile` field shows the file was loaded
  (build logs are a secondary signal only).
- Do not assign a `jesusfilm.org` DNS entry - the stub stays on the
  Railway-generated domain until Cloudflare fronting is wired (alongside
  auth, later).
- Do not model lint/tsconfig/scripts on `apps/roadmap` - it never runs in CI
  (unscoped package name misses the `@forge/*` affected filter) and its lint
  setup is broken. CI-exercised config comes from `apps/web`.

## Verification

```bash
pnpm --filter @forge/chat lint
pnpm --filter @forge/chat typecheck
pnpm --filter @forge/chat build
pnpm --filter @forge/chat dev   # http://localhost:3200 - send a message, get a stubbed reply
```

Check `apps/chat/README.md`, `CLAUDE.md`, and `AGENTS.md` exist and state the
stub-only scope; check root `CLAUDE.md`/`AGENTS.md` mention `apps/chat`.
