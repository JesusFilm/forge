---
date: "2026-06-10"
topic: "chat-app-scaffold"
---

# Chat App Scaffold — Requirements

## Summary

Scaffold a new `apps/chat` workspace app (`@forge/chat`): a minimal Next.js chat UI with a single full-screen chat page whose assistant replies come from a pure client-side stub. Ships with a README, CLAUDE.md, AGENTS.md, and a config-as-code Railway deployment. Template is a hybrid: `apps/roadmap` for footprint and Railway config, `apps/web` for the CI-checked engineering config. The app will eventually connect to the Mastra agents in `apps/mastra`; for now nothing is wired.

## Key Decisions

- **Name: `apps/chat` / `@forge/chat`.** Short, follows the `@forge/*` convention. Renaming later is cheap while the app is repo-only — nothing imports a frontend app and no codegen keys to its name. Once the Railway service is wired (R13), a rename must also re-point the service's config-as-code path and update `railway.toml`'s filter/watch paths, or the config silently goes dead (the `apps/admin` failure mode).
- **Pure client-side stub, no API route.** Replies are faked entirely in client state. Fastest scaffold; the eventual Mastra hookup adds the server surface later rather than swapping a stub route.
- **Single chat page only.** No conversation sidebar, no multi-conversation shell. The smallest UI that proves the scaffold end to end.
- **Config-as-code Railway deployment.** `railway.toml` with the railpack builder, following `apps/roadmap` (the repo's live config-as-code precedent), not dashboard-managed like `apps/web`. Reviewable, agent-legible, reproducible.
- **Hybrid template.** `apps/roadmap` models the footprint (minimal dependencies) and the `railway.toml`; `apps/web` models everything CI exercises — ESLint config (extends the root `eslint.config.mjs` + `eslint-config-next/core-web-vitals`), strict `src/`-layout tsconfig (ES2022, `allowJs: false`), the script set, vitest shape, and dependency versions. Reason: `@forge/chat` runs in CI and web is the only CI-proven template; roadmap never runs CI and its lint setup is broken (no ESLint config file, no `typecheck` script).
- **Docs are guardrails.** CLAUDE.md/AGENTS.md state the eventual Mastra connection and list what is intentionally absent, so future agents don't helpfully over-build.

## Requirements

**App scaffold**

- R1. New pnpm workspace app at `apps/chat` named `@forge/chat`, using Next.js App Router, strict TypeScript, and Tailwind v4 — roadmap-minimal footprint with `apps/web`'s engineering config per the hybrid-template decision.
- R2. Standard scripts (`dev`, `build`, `start`, `lint`, `typecheck`) so turbo-driven CI picks the app up with zero CI changes.
- R3. Dev server runs on port 3200 (3000, 3002–3005, 3010, and 3100 are taken).

**Chat UI and stub**

- R4. One full-screen chat page: message history, text input, send action. The empty message history shows a centered placeholder prompt before the first message.
- R5. Assistant replies come from a client-side stub — no API route, no network calls; chat state resets on refresh. The stub simulates a brief reply delay with a visible pending indicator, so the UI shape matches the eventual async agent.
- R6. Stubbed replies are recognizable as stubbed, so nobody mistakes the scaffold for a working agent.
- R7. The input and send action are disabled while a reply is pending.

**Documentation**

- R8. README covers what the app is, how to run it locally, and a Railway service setup checklist (see R13).
- R9. CLAUDE.md (short, roadmap-style) covers: what this is, the eventual `apps/mastra` connection (integration path undecided — see Outstanding Questions), the intentionally-absent list (no auth, no database, no API routes, no real agent), key conventions, a Development section with the local commands (`pnpm --filter @forge/chat dev` and friends), and deployment.
- R10. AGENTS.md (pointer-style) states the scope boundary and a stub-only guardrail: do not wire real agents, auth, or a database without a roadmap ticket.
- R11. Root `CLAUDE.md` registers the new app in its Monorepo Structure list and Package-Specific Instructions section; root `AGENTS.md` follows its existing per-app registration pattern.

**Deployment**

- R12. `railway.toml` in `apps/chat` using the railpack builder, modeled on `apps/roadmap/railway.toml`, with `watchPatterns` scoped to `apps/chat/**`.
- R13. The README's Railway checklist covers the manual dashboard steps — create the service, point it at the config file, and verify the deployment record's `configFile` field shows the file was loaded (build logs are a secondary signal only; the `configFile: null` deployment record is what exposed admin's dead config). `apps/admin/railway.toml` is the cautionary example: a config file the service never reads is worse than none.
- R14. The deployed stub stays on the Railway-generated domain; no `jesusfilm.org` DNS entry until Cloudflare fronting is wired (expected alongside auth). The README checklist states this.

## Scope Boundaries

Deferred, and documented as deferred in the app's own docs:

- Auth (will come later)
- Database / persistence (may come later)
- Real Mastra agent connection, API routes, streaming
- Multi-conversation UI / sidebar
- i18n, design-system sharing with `apps/web`

## Dependencies / Assumptions

- Railway service creation and wiring is manual dashboard work by someone with Railway access; the repo can only carry the config file and the checklist.
- The Mastra agents in `apps/mastra` are untouched by this work.
- `apps/roadmap` has never run in CI — the affected filter only matches `@forge/*` package names and roadmap is unscoped, which is why every CI-exercised config (lint, tsconfig, scripts) is modeled on `apps/web` instead.

## Outstanding Questions

Deferred to planning:

- Stub reply behavior: fixed canned response vs echo vs small rotating set.
- Whether the message data shape should mirror the AI SDK message shape now to ease the later Mastra swap, or stay minimal.
- Whether to include a vitest setup in the scaffold or add it with the first real logic.
- Whether the eventual Mastra connection goes direct to `apps/mastra` (server-to-server bearer) or through the existing `apps/mastra-gateway` proxy — the repo's established browser-facing path. The app's CLAUDE.md states this as undecided rather than implying direct wiring.

## Sources

- `apps/roadmap/` — footprint and `railway.toml` template (railpack). Its lint/typecheck config is unvetted — no ESLint config file, no `typecheck` script — and is not copied.
- `apps/web/` — source of the CI-proven engineering config: `eslint.config.mjs` (extends root config + next core-web-vitals), strict `src/`-layout tsconfig, vitest config, script set, current dependency versions. Its app-specific layers (i18n, Apollo/admin data layer, feature flags) are not copied.
- `apps/admin/railway.toml` — dead-config cautionary example motivating R12.
- `docs/roadmap/content-discovery/feat-170-yt-video-mapper-backend-scaffold.md` — prior app-scaffold ticket shape.
