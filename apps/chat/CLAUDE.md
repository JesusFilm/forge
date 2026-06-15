# CLAUDE.md — Forge Chat

## What This Is

A chat UI scaffold for the Forge Mastra agents: one full-screen chat page
whose assistant replies come from a pure client-side stub
(`src/lib/chat-stub.ts`). No data layer — chat state lives in the client
and resets on refresh.

## Eventual Mastra Connection

This app will eventually talk to the agents in `apps/mastra`. The
integration path is **undecided**: direct server-to-server (bearer, like
admin's `MASTRA_BASE_URL` pattern) vs through the existing
`apps/mastra-gateway` proxy (the repo's established browser-facing path —
see `docs/solutions/platform/mastra-studio-gateway-auth-railway-pattern-20260522.md`).
Do not wire either without a roadmap ticket that settles the path.

`src/lib/chat-stub.ts` is the seam the real wiring replaces: the `Message`
shape (`id`/`role`/`content`) is AI-SDK-aligned so the swap renames nothing.

## Intentionally Absent

- No auth (lands later, alongside Cloudflare fronting)
- No database or conversation persistence
- No API routes, server actions, or streaming
- No real agent connection
- No conversation sidebar / multi-conversation shell
- No env vars — hence no `env.ts` validation scaffold
- No i18n, no design-system sharing with `apps/web`

## Key Conventions

- Server Components by default; `src/components/chat/chat.tsx` is the one
  client component (state + interaction).
- Strict TypeScript, `src/` layout, `@/*` path alias — config mirrors
  `apps/web` (the CI-proven template).
- Tailwind v4, CSS-first (`@import "tailwindcss"` in `src/app/globals.css`;
  no tailwind.config file).
- Tests colocated (`*.test.ts(x)`); component tests use plain
  `react-dom/client` + `act` with per-file `// @vitest-environment jsdom`
  (the `apps/admin` style — no testing-library).
- Runs on port **3200**.

## Development

```bash
pnpm --filter @forge/chat dev         # http://localhost:3200
pnpm --filter @forge/chat build
pnpm --filter @forge/chat lint
pnpm --filter @forge/chat typecheck
pnpm --filter @forge/chat test
```

## Deployment

Railway via `railway.toml` (railpack builder), but only once the service's
"Config-as-code Path" points at the file — see README's wiring checklist
and its `configFile` verification step. Stays on the Railway-generated
domain; no `jesusfilm.org` DNS until Cloudflare fronting lands.
