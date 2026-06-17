# CLAUDE.md — Forge Chat

## What This Is

A chat UI for the Forge Mastra agents (jesusfilm.ai). The initial styling
follows the "Vigil" design direction (see below) — a starting point handed to
us to get going, not a locked-in convention; expect it to evolve. Assistant
replies still come from a pure client-side stub
(`src/lib/chat-stub.ts`) — no data layer, no agent wiring yet. Conversation
state lives in the client and resets on refresh.

## Architecture

```
src/
  app/
    layout.tsx           Root layout; loads globals.css (server)
    page.tsx             Renders <AppShell /> (server)
    globals.css          "Vigil" token layer — Tailwind v4 @theme palette + fonts + base styles
  components/
    shell/
      app-shell.tsx      'use client' — owns conversation state via useConversations; lays out sidebar + chat
      sidebar.tsx        Left rail: brand lockup, "New conversation", conversation list (presentational)
    chat/
      chat.tsx           Conversation pane — the centered 680px reading "room" (presentational)
      message-list.tsx   Renders turns (Embersoot user bubble / plain assistant text) + pending pulse cursor
      composer.tsx       Auto-growing textarea + 12px Vesper send-dot (no paper-airplane icon)
      empty-state.tsx    "What would you like to ask?" heading + starter questions
    brand/
      brand-lockup.tsx   Inlined JFP flag mark + "jesusfilm.ai" wordmark
  lib/
    chat-stub.ts         Reply-generation seam — the Mastra wiring replaces THIS file
    conversations.ts     Message + Conversation types + createConversation / deriveTitle helpers
    use-conversations.ts Client hook: send + per-conversation reply timers + per-conversation pending + double-send guard + new/select conversation
public/                  Static assets served by URL (Next.js convention, matches apps/web)
  brand/
    jfp-sign.svg         JFP flag mark — canonical source (the mark is inlined in brand-lockup.tsx)
    jesus-film-logo.svg  Full wordmark (unused for now; kept for longer-form surfaces)
```

- **State ownership:** all conversation state lives in `useConversations`,
  consumed by `AppShell`. Everything else is presentational and receives props
  — `chat.tsx` does not own state. Data flows one way:
  `useConversations` → `AppShell` → `Sidebar` / `Chat` → leaf components.
- **The stub seam:** reply generation is isolated in `lib/chat-stub.ts`. The
  hook only orchestrates timing, the per-conversation pending/double-send guard,
  and which conversation a reply lands in. The `Message` type lives in
  `lib/conversations.ts` (NOT in the stub seam) so it survives the seam's
  deletion; its `id`/`role`/`content` shape is AI-SDK-aligned so the eventual
  swap renames nothing.
- **Sidebar is our own addition**, not from the design system — the Vigil
  system as handed to us is single-surface (it lists no conversation sidebar),
  so the rail was built from its tokens rather than copied from it. This too may
  change. Multi-conversation state is client-only and resets on refresh (no
  DB/users yet).

### Initial design direction — "The Vigil"

The first styling pass follows the jesusfilm.ai design system, ported into
`globals.css` as Tailwind v4 `@theme` tokens. **This is a starting point and
may change** — treat it as the current direction, not a hard rule. The one part
worth keeping regardless: where tokens exist, prefer the token utilities over
raw hex/values (that's just code hygiene, not a design commitment).

- **Palette:** `hearthblack` (bg), `embersoot` (cards/user bubbles), `linen`
  (text), `vellum` (scripture), `ash` (metadata), `vesper` (terracotta —
  primary action), `lamplight` (the one warm accent — cursor/pulse, never
  buttons). E.g. `bg-hearthblack`, `text-linen`, `border-linen/10`.
- **Fonts (three, no fourth):** `font-display` (Newsreader serif — headings),
  `font-body` (Inter Tight — UI/chat, weights 400/500 only), `font-scripture`
  (Cormorant Garamond italic — quoted scripture only).
- **Currently avoided** (per the source system, not immutable): pure
  `#FFF`/`#000`, gradients (except the composer protection fade), cold blues,
  glassmorphism, and emoji.

## Eventual Mastra Connection

This app will eventually talk to the agents in `apps/mastra`. The
integration path is **undecided**: direct server-to-server (bearer, like
admin's `MASTRA_BASE_URL` pattern) vs through the existing
`apps/mastra-gateway` proxy (the repo's established browser-facing path —
see `docs/solutions/platform/mastra-studio-gateway-auth-railway-pattern-20260522.md`).
Do not wire either without a roadmap ticket that settles the path.

`src/lib/chat-stub.ts` is the seam the real wiring replaces. The `Message` type
lives in `src/lib/conversations.ts` (so it outlives the seam); its
`id`/`role`/`content` shape is AI-SDK-aligned so the swap renames nothing.

## Intentionally Absent

- No auth (lands later, alongside Cloudflare fronting)
- No database or conversation persistence (conversations are client-only)
- No API routes, server actions, or streaming
- No real agent connection
- No env vars — hence no `env.ts` validation scaffold
- No i18n, no design-system sharing with `apps/web`

## Key Conventions

- Server Components by default. Client components are the interactive ones:
  `shell/app-shell.tsx`, `shell/sidebar.tsx`, `chat/chat.tsx`,
  `chat/composer.tsx`, and `chat/empty-state.tsx`. `chat/message-list.tsx` is a
  pure presentational render (no hooks/handlers) so it carries no `'use client'`
  and inherits its parent's client context. `brand/*` and the `app/` entry files
  stay server.
- Strict TypeScript, `src/` layout, `@/*` path alias — config mirrors
  `apps/web` (the CI-proven template).
- Tailwind v4, CSS-first (`@import "tailwindcss"` in `src/app/globals.css`;
  no tailwind.config file). Design tokens live in the `@theme` block there.
- Tests colocated (`*.test.ts(x)`); component tests use plain
  `react-dom/client` + `act` with per-file `// @vitest-environment jsdom`
  (the `apps/admin` style — no testing-library). The behavioral suite lives in
  `components/shell/app-shell.test.tsx` (AppShell owns the state).
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
