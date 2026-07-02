# @forge/chat

Chat UI scaffold for the Forge Mastra agents. One full-screen chat page whose
assistant replies come from a pure client-side stub — no API routes, no
network calls, no persistence. The app exists so the UI shell, conventions,
and deploy path are in place before the real agent wiring lands.

Roadmap ticket: `docs/roadmap/ai-chat/feat-200-chat-app-scaffold.md`.
Scope and guardrails: see `CLAUDE.md` and `AGENTS.md` in this directory.

## Local development

```bash
pnpm install                          # from the repo root
pnpm --filter @forge/chat dev         # http://localhost:3200
pnpm --filter @forge/chat lint
pnpm --filter @forge/chat typecheck
pnpm --filter @forge/chat test
pnpm --filter @forge/chat build
```

Use `localhost:3200`, not `127.0.0.1:3200` — Next.js dev silently breaks
hydration when the page origin doesn't match the dev server's origin (see
`docs/solutions/runtime-errors/nextjs-alloweddevorigins-hydration-dead-127-0-0-1-20260520.md`).

## Railway service setup

The repo only carries `railway.toml`; creating and wiring the service is
manual dashboard work. Railway **does not** auto-discover per-app config
files — `apps/admin/railway.toml` sat dead for months because the service
never pointed at it (deployment records showed `configFile: null` while
prod migrations silently skipped; see
`docs/solutions/deployment/railway-dashboard-override-shadows-railway-toml-20260429.md`).

Checklist for whoever wires the service:

1. Create a new service in the `forge` Railway project from this repo.
2. In service settings, set **Config-as-code Path** to
   `apps/chat/railway.toml`.
3. Set `HOSTNAME=0.0.0.0` as a service variable in the dashboard.
   (`[deploy.env]` in railway.toml has been observed to be unreliable —
   `docs/solutions/deployment/nextjs-pnpm-monorepo-railway-standalone.md`.)
4. Deploy, then **verify the deployment record's `configFile` field is
   non-null and reads `/apps/chat/railway.toml`** — this is the proof the
   config file was actually loaded. Build logs are a secondary signal only.
5. Confirm the app responds on the Railway-generated domain and a sent
   message gets a visibly-stubbed reply.

**Stay on the Railway-generated domain.** Do not assign a `jesusfilm.org`
DNS entry — Cloudflare fronting is expected to land alongside auth, later.

## What is intentionally absent

No **authorization** (auth changes identity only, gates nothing), no database or
persistence, no real agent connection. Optional OAuth sign-in against `apps/auth`
(feat-207) and the Seeker proxy (feat-205) are present but **default off** —
the app boots and is fully usable with no env vars set. See `CLAUDE.md` for the
full list, the auth env vars + out-of-codebase client-registration prerequisite,
and the eventual `apps/mastra` connection plan.
