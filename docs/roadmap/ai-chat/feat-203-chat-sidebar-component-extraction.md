---
id: "feat-203"
title: "Chat sidebar component + behavior extraction"
owner: "jian wei"
priority: "P2"
status: "complete"
start_date: "2026-07-01"
duration: 2
depends_on:
  - "feat-201"
blocks: []
tags:
  - "web"
---

## Resolution

**Shipped:** 2026-06-25 via [PR #1368](https://github.com/JesusFilm/forge/pull/1368) (`feat(chat): extract sidebar into hook + sub-components (feat-203)`).

**What landed.** Pure refactor, no behavior change. `sidebar.tsx` (~296 lines) was split into a `useSidebarChrome` hook (the clip-during-collapse state machine + 400ms fallback timer, the Escape-to-close listener, and the mobile-drawer focus trap/restore) plus three presentational sub-components — `SidebarHeader`, `NewConversationButton`, `ConversationList` — with the dispersed `collapsed &&` classes consolidated into a single `collapsedStyles` slot map; the shell now reads ~120 lines. State ownership stayed in `AppShell` per the brief, and the rail was deliberately **not** split by viewport. Added a `useSidebarChrome` unit test plus colocated component and slot-map tests (33 new), keeping the existing `app-shell.test.tsx` behavioral suite green with only import-path changes. Browser-verified in Chromium: desktop collapse/expand (clip reveal + icon rail), mobile drawer open/close, and dialog/focus-trap/focus-restore all behave identically to before.

**Compound docs.** [worktree-pnpm-install-8mb-file-truncation](../../solutions/build-errors/worktree-pnpm-install-8mb-file-truncation-20260624.md) — an incident note produced during this work (a fresh-worktree `pnpm install` truncating large `node_modules` files to exactly 8 MiB); tangential to the sidebar feature itself, but written and shipped in the same PR.

**Residual risk / follow-ups.** [feat-206](feat-206-chat-introduce-react-testing-library.md) was filed off this work — adopting React Testing Library for `apps/chat` would retire the hand-rolled `react-dom`/`act` plumbing and the `useEffect`-capture hook-test workaround this refactor leaned on. The focus-restore-on-close path stays browser-verified only, since jsdom has no layout (`offsetParent` is always null).

## Problem

`apps/chat/src/components/shell/sidebar.tsx` has grown to ~300 lines and now
carries real behavior (collapse/expand width animation with a clip-during-
animation flag + fallback timer, an Escape listener, and a mobile-drawer focus
trap), plus ~11 dispersed `collapsed &&` conditionals encoding three
presentations (desktop expanded, desktop collapsed icon-rail, mobile drawer) in
one element. `apps/chat/CLAUDE.md` already flags that the sidebar holds local UI
mechanics (a noted deviation from its original presentational role). There is no
single place to read what the collapsed rail looks like, and the fiddly
animation/focus edges are interleaved with JSX. This
is fine today but will not hold once the Mastra wiring lands and the rail grows
(history, search, agent affordances). Refactor for clarity **before** that.

This is a pure refactor — no behavior change, no new user-facing feature.

## Entry Points — Read These First

1. `apps/chat/src/components/shell/sidebar.tsx` — the component to split; note
   the `animatingCollapse`/`clip` state machine, the `onTransitionEnd` + 400ms
   fallback effect, the Escape effect, the focus-trap effect, and the
   `collapsed &&`/`collapsed ?` branches across header / new-conversation / nav.
2. `apps/chat/src/components/shell/app-shell.tsx` — owns `collapsed`/`mobileOpen`
   state, the matchMedia breakpoint reset, the scroll-lock effect, and the
   `inert` focus-trap on `<main>`. State ownership must not move.
3. `apps/chat/src/components/shell/app-shell.test.tsx` — the behavioral suite
   (all sidebar tests live here per `apps/chat/CLAUDE.md`); the refactor must
   keep every assertion green with no test rewrites beyond import paths.
4. `apps/chat/CLAUDE.md` → Architecture — update it to match the new structure.

## Grep These

- `collapsed &&` and `collapsed ?` in `sidebar.tsx` — the conditionals to
  consolidate into one slot-keyed style map.
- `animatingCollapse` — the clip state machine to move into a hook.
- `useEffect` in `sidebar.tsx` — the three effects (Escape, focus trap, fallback
  timer) that belong in a behavior hook.
- `nav[aria-label="Conversations"]`, `data-open`, `SIDEBAR_ID` in the test file —
  selectors that must keep resolving after the split.

## What To Build

Refactor in priority order; each step is independently shippable:

1. **Extract a behavior hook** (highest value) — e.g.
   `useSidebarChrome({ collapsed, mobileOpen, onToggleCollapsed, onCloseMobile })`
   returning `{ clip, asideRef/closeRef, handleToggleCollapsed, onTransitionEnd }`.
   Move `animatingCollapse` + fallback timer, the Escape listener, and the
   focus-trap/restore effect into it. Leaves the JSX presentational again
   (restoring the cleaner data-only separation) and makes the state machine
   unit-testable in isolation.
2. **Split sub-components** — `SidebarHeader` (brand + the three toggle variants +
   hover-reveal tooltip), `NewConversationButton`, `ConversationList`. Each gets
   a JSDoc per the comment conventions. The header holds most of the conditional
   soup, so isolating it contains the mess.
3. **`collapsedStyles` map** — collect the dispersed `collapsed &&` class
   fragments into one object keyed by slot (`header`, `wordmark`, `newButton`,
   `nav`), computed once; each JSX node references `collapsedStyles.slot`.

## Constraints

- **No behavior change.** Visuals, animation timing, a11y semantics, and the
  responsive breakpoints stay identical.
- **State ownership stays in `AppShell`.** Do not move `collapsed`/`mobileOpen`
  or the matchMedia/scroll-lock/`inert` logic out of `app-shell.tsx`.
- **Do NOT split by viewport** into separate desktop/mobile components — the
  single-element + `md:`-scoped approach is deliberate (one `nav`, no duplicated
  conversation list, the test suite finds one of each). Splitting would
  reintroduce duplication and break the shared-DOM model.
- Keep the behavioral suite in `app-shell.test.tsx`; add hook-level unit tests
  beside the hook if extracted.
- Honor the comment rules in `apps/chat/CLAUDE.md` (inline ≤3 lines; JSDoc on
  every new exported component/hook).

## Verification

- `pnpm --filter @forge/chat test` — all existing tests pass unchanged (only
  import paths may move).
- `pnpm --filter @forge/chat lint` and `... typecheck` clean.
- Manual (Chromium): desktop expand/collapse (smooth clip reveal, hover tooltip),
  mobile drawer open/close (slide, scrim, X, Escape), and the resize-across-`md`
  reset all behave exactly as before.
- `sidebar.tsx` is materially smaller and the collapsed-state policy is readable
  in one place.
