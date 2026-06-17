---
id: "feat-192"
title: "Chat app Vigil re-skin + conversation shell"
owner: "jianwei"
priority: "P1"
status: "complete"
start_date: "2026-06-15"
duration: 1
depends_on:
  - "feat-174"
blocks: []
tags:
  - "web"
  - "chat"
  - "ai-chat"
---

## Problem

The `apps/chat` scaffold (feat-174) shipped as a bare stub: a single
white-background chat page with blue bubbles and a "Send" button — visually the
opposite of the jesusfilm.ai brand, and structurally a single growing
`chat.tsx`. Before layering on real features (memory, auth, DB, agent wiring) it
needs (1) a brand-aligned look and (2) a component structure that won't collapse
into one file as it grows. It also needs the multi-conversation shell users
expect (a left rail with new/select conversation), which the scaffold
deliberately omitted.

This is a UI-only slice: no agent wiring, no persistence, no env vars. The
`chat-stub.ts` reply seam stays untouched.

## Entry Points — Read These First

1. `apps/chat/CLAUDE.md` — "Architecture" + "Initial design direction — The
   Vigil" sections describe the token layer, component tree, and that the design
   direction is a starting point, not a hard convention.
2. `apps/chat/src/app/globals.css` — the ported "Vigil" token layer (Tailwind v4
   `@theme`: palette, fonts, vignette).
3. `apps/chat/src/components/shell/app-shell.tsx` — owns conversation state via
   `useConversations`; lays out sidebar + chat.
4. `apps/chat/src/lib/use-conversations.ts` — send / reply-timer / pending-guard
   / new+select conversation logic (lifted out of `chat.tsx`).
5. `apps/chat/.tmp/design-system/` — the source "Vigil" design system (gitignored
   working copy; not committed).

## Grep These

- `@theme` in `apps/chat/src/app/globals.css` — token definitions.
- `bg-hearthblack`, `text-linen`, `text-vesper`, `font-display` — token-utility
  usage across components.
- `useConversations` — the single state owner.
- `data-pending` — the pending-turn marker (Lamplight pulse cursor, not an "AI
  is thinking" label).
- `BrandLockup` — inlined JFP flag mark + wordmark.

## What To Build

Delivered in this branch (`feat/ai-chat-web-ui`):

- **Token layer.** Port the jesusfilm.ai "Vigil" design system into
  `globals.css` as Tailwind v4 `@theme` tokens — warm-dark palette
  (`hearthblack`/`embersoot`/`linen`/`vesper`/`lamplight`), three fonts
  (Newsreader / Inter Tight / Cormorant Garamond), and a page vignette.
- **Re-skin** the chat to The Vigil: dark canvas, Embersoot user bubble
  (12/12/4/12 radius), plain-text assistant turns, a 12px Vesper send-dot
  (no paper-airplane), the centered 680px reading "room", and a Lamplight
  pulse-cursor pending state.
- **Brand lockup** (`components/brand/brand-lockup.tsx`): inlined JFP flag mark +
  `jesusfilm.ai` wordmark at the top of the sidebar. Source SVGs in
  `apps/chat/public/brand/` (Next.js `public/` convention, matching `apps/web`).
- **Left sidebar** (`components/shell/sidebar.tsx`): ChatGPT-style rail with
  "+ New conversation" and a conversation list; active highlight; first user
  message auto-titles the conversation. **Client-only, no persistence** — resets
  on refresh (no DB/users yet). This is a brand _extension_; the Vigil system as
  given is single-surface.
- **Clean component split.** `chat.tsx` becomes a presentational conversation
  pane; new `composer.tsx`, `empty-state.tsx`, `message-list.tsx`. All state
  lives in `useConversations`, consumed by `AppShell`. One-way data flow.
- **Tests.** Behavioral suite relocated to `components/shell/app-shell.test.tsx`
  (AppShell owns state); pure-unit `lib/conversations.test.ts` for
  `deriveTitle`/`createConversation`.

## Constraints

- **UI only.** No agent connection, API routes, server actions, streaming, auth,
  database, or env vars. The `chat-stub.ts` reply seam is untouched.
- **Design direction is provisional**, not a locked convention — it may change.
- **No new per-component presentational tests** while the UI is in flux; the
  AppShell integration test is the behavioral net.
- Server Components by default; only the shell + chat components are
  `'use client'`. Tailwind v4 CSS-first; no `tailwind.config`.
- The `.tmp/design-system/` working copy stays gitignored and is never committed.

## Verification

```bash
pnpm --filter @forge/chat typecheck   # clean
pnpm --filter @forge/chat test        # 22 tests pass (stub 3 + conversations 6 + app-shell 13)
pnpm --filter @forge/chat lint        # clean
pnpm --filter @forge/chat dev         # http://localhost:3200
```

In-browser smoke (headless Chromium via chrome-devtools MCP): empty state shows
the Newsreader prompt + starters; clicking a starter sends → Embersoot user
bubble + stub reply; sidebar item auto-retitles; "+ New conversation" opens a
fresh empty conversation while the prior one persists in the rail.

## What was shipped

Delivered via **#1277** (squash-merged into trunk **#1276**). A follow-up pass
with `/ce-code-review` (three rounds) hardened the shipped UI — same scope, no
new requirements — landed in **#<follow-up PR>**:

- Pending state moved from one global flag to **per-conversation** (single
  source of truth): the pulse cursor + disabled composer attach to the
  conversation actually awaiting a reply, and one slow reply no longer locks the
  others.
- Reply-slot release wrapped in `try/finally` (fire-and-forget slot-leak guard),
  ahead of the eventual Mastra async swap.
- `Message` type moved to `conversations.ts` so it survives the stub seam's
  deletion.
- Behavioral tests added for mid-reply switching, parallel sends, and the
  slot-leak guard.

Recorded here in lieu of a separate ticket.
