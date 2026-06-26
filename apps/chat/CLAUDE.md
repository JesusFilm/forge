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
    page.tsx             Reads isSeekerChatEnabled() (force-dynamic) → <AppShell seekerEnabled> (server)
    globals.css          "Vigil" token layer — Tailwind v4 @theme palette + fonts + base styles
    api/
      seeker/route.ts    'force-dynamic' POST proxy → Mastra /forge-seeker SSE (feat-205): bearer server-side, SSRF+https guard, redirect:"error", timeout-bounded, normalizes every failure to one terminal error{reason} frame. Testable core handleSeekerProxyRequest
  config/
    env.ts               Validated env (zod, all .optional()): SEEKER_CHAT_ENABLED flag + Mastra base URL/bearer/allowlist/timeout. isSeekerChatEnabled() + seekerTimeoutMs(). Boots clean with none set
  components/
    shell/
      app-shell.tsx      'use client' — owns conversation state (useConversations) + sidebar view state (collapsed rail / mobile drawer open); matchMedia breakpoint reset, body scroll-lock, <main> inert focus-trap
      sidebar.tsx        'use client' — responsive left rail composition (scrim + <aside>): desktop expanded ↔ collapsed icon-rail + mobile off-canvas drawer. Presentational shell now — UI mechanics live in use-sidebar-chrome, collapsed-style policy in sidebar-collapsed-styles, sub-rows in the sidebar-* components
      use-sidebar-chrome.ts        'use client' — sidebar UI-mechanics hook: collapse clip state machine (+ 400ms fallback timer), Escape-to-close listener, drawer focus trap/restore. Derives presentation from collapsed/mobileOpen; owns no view state
      sidebar-collapsed-styles.ts  collapsedStyles(collapsed) → the md:-scoped collapsed-rail class policy in one slot-keyed map (header/brand/wordmark/newButton/nav)
      sidebar-header.tsx           Brand mark + wordmark + the three mutually-exclusive controls (desktop collapse toggle / collapsed expand affordance / mobile close X); presentational
      sidebar-new-conversation.tsx New-conversation action (full-width labeled ↔ centered icon-only when collapsed); presentational
      sidebar-conversation-list.tsx Conversation history nav (select + per-row replying pulse; hidden when collapsed); presentational
      icons.tsx          Inline line-icon components (panel/compose/menu/close) — currentColor, no icon dependency, no emoji
    chat/
      chat.tsx           Conversation pane — the centered 680px reading "room" (presentational)
      message-list.tsx   Renders turns (Embersoot user bubble / plain assistant text) + streaming pulse (aria-live), grounded badge (3 states), engine marker, role="alert" failure notice
      sources-list.tsx   Cited passages or explicit "No sources cited" state; untrusted RAG sources → https-only links (rel=noopener), text never HTML (feat-205)
      composer.tsx       Auto-growing textarea + 12px Vesper send-dot (no paper-airplane icon)
      empty-state.tsx    "What would you like to ask?" heading + starter questions
    brand/
      brand-lockup.tsx   Inlined JFP flag mark + "jesusfilm.ai" wordmark
  lib/
    chat-stub.ts         Reply seam (still the single swap point): streamReply() — stub path (buildStubReply) OR Seeker path (POST /api/seeker, parse SSE, first-terminal-wins)
    sse.ts               Chat-local SSE parser (readSseStream + encodeSseFrame), forked from admin's reference; used by the proxy AND the client seam
    cn.ts                Tiny conditional-className joiner (no clsx/tailwind-merge dependency)
    conversations.ts     Message (+ optional sources/grounded/engine/error) + SeekerSource + ReplyFailureReason + Conversation types + createConversation / deriveTitle
    use-conversations.ts Client hook: send + async streaming lifecycle (empty assistant turn → token append → terminal finalize/error) + per-conversation AbortController slot (pending + double-send guard, released in finally) + new/select conversation
public/                  Static assets served by URL (Next.js convention, matches apps/web)
  brand/
    jfp-sign.svg         JFP flag mark — canonical source (the mark is inlined in brand-lockup.tsx)
    jesus-film-logo.svg  Full wordmark (unused for now; kept for longer-form surfaces)
```

- **State ownership:** all conversation state lives in `useConversations`,
  consumed by `AppShell`, which also owns sidebar _view_ state (`collapsed`,
  `mobileOpen`). Data flows one way: `useConversations`/view-state → `AppShell`
  → `Sidebar` / `Chat` → leaf components. Both `chat.tsx` and `sidebar.tsx` are
  presentational compositions now: `sidebar.tsx` lays out the scrim + `<aside>`
  and delegates its local _UI mechanics_ (collapse clip animation, Escape
  listener, drawer focus trap) to the `useSidebarChrome` hook, its collapsed
  class policy to `collapsedStyles`, and its rows to the `sidebar-*`
  sub-components (feat-203). State ownership stays in `AppShell` — the hook
  only derives presentation from the `collapsed`/`mobileOpen` flags.
- **The reply seam:** reply generation is isolated in `lib/chat-stub.ts`
  (`streamReply` — stub path OR Seeker proxy, selected by the `seekerEnabled`
  flag). The hook orchestrates the streaming lifecycle (append an empty assistant
  turn, feed `onToken` into it, finalize/error on the terminal result), the
  per-conversation pending/double-send guard, and which conversation a reply
  lands in. The `Message` type + `SeekerSource` + `ReplyFailureReason` live in
  `lib/conversations.ts` (NOT in the seam) so they survive the seam's deletion;
  the `id`/`role`/`content` core is AI-SDK-aligned. See "Mastra Connection
  (Seeker, feat-205)" below for the proxy + flag + accepted-risk detail.
- **Sidebar is our own addition**, not from the design system — the Vigil
  system as handed to us is single-surface (it lists no conversation sidebar),
  so the rail was built from its tokens rather than copied from it. It is
  responsive (Gemini-style): a desktop rail that collapses to an icon column,
  and a mobile off-canvas drawer (hamburger opens; scrim / X / Escape close;
  `<main>` is `inert` while open). This too may change. Multi-conversation state
  is client-only and resets on refresh (no DB/users yet).

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

## Mastra Connection (Seeker, feat-205)

The integration path is **settled**: direct server-to-server bearer (admin's
`MASTRA_BASE_URL` pattern), NOT the `apps/mastra-gateway` browser-facing path.
feat-205 wired a feature-flagged proxy to the internal `/forge-seeker` SSE route
(see `docs/plans/2026-06-26-001-feat-chat-wire-seeker-route-plan.md` +
`docs/brainstorms/2026-06-25-chat-wire-seeker-route-requirements.md`).

- **Flag-gated, default off.** `SEEKER_CHAT_ENABLED` (server env, read in
  `page.tsx` via `force-dynamic`, passed as the `seekerEnabled` prop) selects the
  reply source. Off/unset → the original client stub (`buildStubReply`); on →
  messages stream from Seeker.
- **The seam is `src/lib/chat-stub.ts`** (`streamReply` — stub path + Seeker
  path), still the single swap point. The `Message` type + `SeekerSource` +
  `ReplyFailureReason` live in `src/lib/conversations.ts` so they outlive the seam.
- **The proxy** is `src/app/api/seeker/route.ts` (+ `src/lib/sse.ts` parser). It
  holds the bearer server-side, SSRF-checks the base host + enforces `https:`,
  `redirect:"error"`, bounds the call with `SEEKER_TIMEOUT_MS` (95s > Mastra's
  90s ceiling), and normalizes every failure to one terminal `error{reason}` SSE
  frame. Plain-string logging only.
- **Accepted v1 risk:** the proxy is unauthenticated + un-rate-limited +
  world-reachable, gated only by URL obscurity + a small trusted audience (NOT a
  gate). Inbound auth + a rate/concurrency cap are prerequisites before the
  audience widens — do not "fix" the open proxy without that work.

The three former "deferred hardening" criteria (surface failures, outbound
timeout, single-file async seam) are now **implemented**: failures render a
`role="alert"` notice keeping partial text; the call is timeout-bounded; the seam
is async (`streamReply`) and the hook only awaits it.

## Intentionally Absent

- No auth on the chat origin or the `/api/seeker` proxy (lands later, alongside
  Cloudflare fronting + a rate cap — see the accepted-risk note above)
- No database or conversation persistence (conversations are client-only; Seeker
  memory is Mastra's in-memory store, lost on its restart)
- No browser-direct Mastra path / CORS (server-to-server bearer only)
- No i18n, no design-system sharing with `apps/web`

Now present (feat-205, behind the default-off flag): a validated `env.ts`, the
`/api/seeker` App Router route handler, and SSE streaming.

## Key Conventions

- Server Components by default. Client components are the ones holding hooks:
  `shell/app-shell.tsx`, `shell/sidebar.tsx`, `shell/use-sidebar-chrome.ts`,
  `chat/chat.tsx`, `chat/composer.tsx`, and `chat/empty-state.tsx`.
  `chat/message-list.tsx`, `chat/sources-list.tsx`, and the
  `shell/sidebar-{header,new-conversation,conversation-list}.tsx`
  sub-components carry no `'use client'` — they have event handlers but no hooks,
  so they inherit the client context of the `'use client'` modules that import
  them (`shell/icons.tsx`, the stateless SVGs, is the same). `shell/sidebar-collapsed-styles.ts`
  (a pure class-map function), `brand/*`, `lib/cn.ts`, `lib/sse.ts`, the `app/`
  entry files, and the server-only modules (`config/env.ts`, `app/api/seeker/route.ts`)
  stay server / framework-agnostic.
- Strict TypeScript, `src/` layout, `@/*` path alias — config mirrors
  `apps/web` (the CI-proven template).
- Tailwind v4, CSS-first (`@import "tailwindcss"` in `src/app/globals.css`;
  no tailwind.config file). Design tokens live in the `@theme` block there.
- Tests colocated (`*.test.ts(x)`). Component tests use **React Testing
  Library** (`render` / `screen` / `within` + `@testing-library/user-event`,
  with `@testing-library/jest-dom` matchers); the hook test uses `renderHook`.
  jsdom is the app-wide test env (`vitest.config.ts` `environment: "jsdom"` +
  `vitest.setup.ts`), so there are no per-file `// @vitest-environment`
  directives. This is a **deliberate divergence** from the `apps/admin` /
  `apps/web` no-testing-library convention (plain `react-dom/client` + `act`),
  scoped to chat by design — it does not change those apps. Pure-function tests
  (`lib/conversations.test.ts`, `lib/chat-stub.test.ts`,
  `shell/sidebar-collapsed-styles.test.ts`) stay plain vitest. The behavioral
  suite lives in `components/shell/app-shell.test.tsx` (AppShell owns the
  state); the extracted `use-sidebar-chrome` hook has its own colocated
  `renderHook` unit test for its state machine in isolation. Note for the
  behavioral suite: the reply lands via `setTimeout`, so it runs on fake timers
  with `userEvent.setup({ advanceTimers, ... })` under
  `vi.useFakeTimers({ shouldAdvanceTime: true })` — a plain fake clock hangs
  user-event's awaited interactions. Layout/visibility behavior jsdom can't
  represent (e.g. focus-restore-on-close, which depends on `offsetParent`) stays
  **browser-verified**, not asserted in jsdom.
- Runs on port **3200**.

### Comments

- **Inline comments are 3 lines maximum.** This applies to every `//` comment
  that explains code (in function bodies, beside JSX) and to file/module
  headers. If a note needs more, cut it down to the load-bearing insight.
- **Every new exported building block — component, hook, or non-trivial module —
  gets a JSDoc (`/** … \*/`) block** directly above it, describing its purpose
and any non-obvious behavior: for a component, what it renders and its key
props/state; for a hook or module, what it does and its inputs/outputs. This
is the one exception to the 3-line cap — keep it concise. Trivial one-line
helpers (e.g. a `cn`class joiner) don't need one; a short`//` note is fine.

## Development

```bash
pnpm --filter @forge/chat dev         # http://localhost:3200
pnpm --filter @forge/chat build
pnpm --filter @forge/chat lint
pnpm --filter @forge/chat typecheck
pnpm --filter @forge/chat test
```

Env is optional: the app runs against the stub with no config. To dogfood Seeker
locally, copy `.env.example` → `.env.local` and set `SEEKER_CHAT_ENABLED=true`
plus the Mastra base URL + bearer (see `src/config/env.ts`).

## Deployment

Railway via `railway.toml` (railpack builder), but only once the service's
"Config-as-code Path" points at the file — see README's wiring checklist
and its `configFile` verification step. Stays on the Railway-generated
domain; no `jesusfilm.org` DNS until Cloudflare fronting lands.
