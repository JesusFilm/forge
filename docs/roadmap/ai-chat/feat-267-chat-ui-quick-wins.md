---
id: "feat-267"
title: "Chat UI quick wins: cursor affordance, focus ring, tab identity, mobile hint"
owner: "jian wei"
priority: "P2"
status: "in-progress"
start_date: "2026-07-15"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
---

## Problem

A browser audit of `apps/chat` (2026-07-15, live against Seeker) surfaced a set
of small interaction-polish gaps. This ticket ships the four one-file-scale
fixes from that audit; the remaining findings (markdown rendering, sources
presentation, mobile header bar, duplicate "New conversation" rows, title
regression on hydration, stop-generation affordance) are follow-up tickets —
see Constraints.

The four quick wins:

1. **No `cursor: pointer` anywhere.** Tailwind v4's preflight resets buttons to
   `cursor: default` and the app never restored it — every button (starter
   questions, New conversation, sidebar rows, collapse toggle, Send, Sign out)
   showed the arrow cursor. Only disabled Send had a cursor rule
   (`disabled:cursor-not-allowed`, `composer.tsx`).
2. **No keyboard focus styles.** Zero `:focus`/`:focus-visible` rules in the
   entire CSS — keyboard users got Chrome's default UA ring, which clashes with
   the Vigil palette on a dark surface.
3. **Tab identity.** `<title>` was the internal codename "Forge Chat" and the
   app shipped **no favicon** at all, while the in-app brand is jesusfilm.ai.
4. **Keyboard hint on touch.** The composer footer's "Enter to send · Shift +
   Enter for a new line" hint is meaningless on touch devices and crammed the
   footer into two awkward columns at mobile widths.
5. **Transcript clipped ~100px above the composer** (user-reported, desktop AND
   mobile). The composer block was a flex SIBLING of the scroll container, so
   the scrollport ended at the top of the composer's `pt-16` gradient padding —
   text cut off hard at that invisible boundary, and the "protection gradient"
   faded over its own empty padding instead of over text.

## Entry Points — Read These First

1. `apps/chat/src/app/globals.css` — the Vigil token layer; fixes 1 + 2 land
   here as an `@layer base` block (base so utilities keep winning — the
   composer textarea's `outline-none` must survive).
2. `apps/chat/src/app/layout.tsx` — the `metadata` export; fix 3 (title,
   description, `icons`).
3. `apps/chat/src/components/chat/composer.tsx` — the footer hint span; fix 4.
4. `apps/chat/public/brand/jfp-sign.svg` — already-shipped flag mark, becomes
   the favicon (no new asset).

## Grep These

- `cursor` in `apps/chat/src` — before: only `disabled:cursor-not-allowed`.
- `focus-visible` in `apps/chat/src` — before: nothing.
- `Forge Chat` — the codename title being replaced.

## What To Build

All four are shipped in this ticket's PR:

- `globals.css`: new `@layer base` block —
  `button:not(:disabled) { cursor: pointer }` (restores the affordance
  app-wide, disabled Send keeps `not-allowed`) and
  `:focus-visible { outline: 2px solid var(--color-lamplight); outline-offset: 2px }`
  (lamplight is the palette's one warm accent; `@layer base` keeps the
  utilities layer authoritative, so the composer textarea's `outline-none`
  still applies — its focus cue remains the form's `focus-within` border).
- `layout.tsx`: `title: "jesusfilm.ai — ask anything"`, user-facing
  description, `icons: { icon: "/brand/jfp-sign.svg" }`.
- `composer.tsx`: the keyboard hint span becomes `hidden md:inline`; the
  status text ("Seeker — grounded answers" / blocked-send notices) is
  unchanged and left-aligns alone on mobile.
- `chat.tsx`: the composer moves INSIDE the scroll container as
  `sticky bottom-0`, wrapped in a `min-h-full` flex column (transcript
  `flex-1`) so it stays pinned to the pane bottom when content is short. The
  transcript now scrolls beneath the composer and dissolves through the
  gradient. Pointer-events split (review-hardened): only the transparent
  `pt-16` fade is click-through; a full-width `pointer-events-auto` inner
  wrapper (carrying `px-8 pb-8`) intercepts clicks over the opaque zone so
  invisible transcript links/buttons beneath it can't be activated. The
  scroller carries `[scroll-padding-bottom:13rem]` so keyboard focus
  auto-scroll parks focused elements above the band instead of behind it.
  `role="log"` moved from the scroll container to the inner transcript
  wrapper (turns stay inside it; the composer stays outside the log region,
  as before).

## Constraints

- No design-system changes: no new colors, no new fonts, no icon library. The
  focus ring uses the existing `--color-lamplight` token.
- Do NOT add `cursor-pointer` per-component — one base rule covers current and
  future buttons.
- The rest of the 2026-07-15 audit is explicitly out of scope here: assistant
  markdown rendering and the sources-list redesign are substantive features
  (security-sensitive rendering seams, R21 replay parity) and get their own
  tickets; the remaining small/medium polish items (mobile header bar,
  duplicate "New conversation" rows, hydration title regression,
  stop-generation affordance, Grounded/SEEKER badge copy, send-dot affordance)
  batch into a follow-up cleanup ticket.

## Verification

```bash
pnpm --filter @forge/chat typecheck
pnpm --filter @forge/chat lint
pnpm --filter @forge/chat test
```

Browser (`pnpm --filter @forge/chat dev` → http://localhost:3200):

- Every enabled button computes `cursor: pointer`; disabled Send computes
  `not-allowed` (spot-check via
  `getComputedStyle(document.querySelector('button')).cursor`).
- Tab through the empty state: starter questions show a 2px lamplight outline;
  tabbing into the composer textarea shows the border cue, not a double ring.
- Tab title reads "jesusfilm.ai — ask anything"; the JFP flag mark renders as
  the favicon.
- At a 390px viewport the composer footer shows only the status line; at ≥768px
  the Enter-to-send hint returns.
- Open a long conversation and scroll to the middle: text runs to the composer
  and fades through the gradient — no hard clip above the box. On a fresh
  empty conversation the composer stays pinned to the pane bottom. Sends still
  work (the fade band must not swallow clicks on the card).

All five verified in headless Chromium on 2026-07-15 (desktop 1440×900 +
mobile 390×844), with the full suite green (418 tests) and no load-time
impact (FCP 116ms on a cold dev reload; structure-only change, no new
resources).
