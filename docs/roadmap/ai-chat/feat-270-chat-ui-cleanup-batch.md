---
id: "feat-270"
title: "Chat UI cleanup batch: mobile header, sidebar dupes, titles, stop, badges"
owner: "jian wei"
priority: "P2"
status: "complete"
start_date: "2026-07-27"
duration: 3
depends_on: []
blocks: []
tags:
  - "web"
---

## Resolution

**Shipped:** 2026-07-20 via [PR #1626](https://github.com/JesusFilm/forge/pull/1626) (`feat(chat): ui cleanup batch — mobile header, stop control, titles, badges (feat-270)`).

**What landed.** All eight items, with three notable calls beyond the brief: the stop control (item 4) marks EVERY user-stopped Seeker turn server-persisted — Mastra creates the thread row before generating, so even a zero-token stop may have persisted it, and a missing stamp would let a later gate denial silently stub-fork (KTD10); item 7's re-pin decision was extracted as the table-tested pure `shouldRepin` (pre-resize distance, both directions — the inline first draft shipped a `Math.max` clamp bug to review, caught and fixed pre-PR) while the ResizeObserver seam stays browser-verified; item 3's optional "delayed title refetch after a thread's first reply" was deliberately skipped — snippet titles now cover the visible gap and LLM titles land on the next hydration. Item 5 kept the visible Stub marker (mixed conversations stay distinguishable) and moved the machine `data-engine` tag to the turn element.

**Compound docs.** [`docs/solutions/ui-bugs/sticky-overlay-scroll-container-pointer-events-scroll-padding.md`](../../solutions/ui-bugs/sticky-overlay-scroll-container-pointer-events-scroll-padding.md) — extended with the law's third control: re-pin on overlay resize compares the PRE-resize distance, including the formula-attributable yank window vs the browser's own scroll clamp and the discriminating probe-window rule.

**Residual risk / follow-ups.** Accepted: a stop racing an already-settled terminal frame renders the full badged reply (the answer was complete). Noted, pre-existing: `apps/chat/AGENTS.md` still describes the app as stub-only (superseded by feat-205/208/241) — worth a prose sweep; the apps/chat 3-line comment cap has no lint enforcement (review caught six violations in this batch alone).

## Problem

The remaining small/medium findings from the 2026-07-15 UI audit, batched into
one ticket + one verification pass (each is too small to track alone):

1. **Mobile hamburger floats over content.** At <768px the "Open menu" button
   has no header bar — it sits directly on top of transcript/heading text.
2. **"New conversation" rows duplicate.** The new-conversation action always
   creates another empty conversation; empty ones accumulate as identical
   "New conversation" rows under the identically-labeled action button.
3. **Thread titles regress on hydration.** A thread titled from its first
   message in-session ("Is doubt a sin?") re-hydrates after reload as the
   generic `fallbackTitle` date label ("Conversation — Jul 15") until the LLM
   title eventually lands on a later hydration.
4. **No stop-generation affordance.** Replies stream up to ~90s; the composer
   sits disabled the whole time with no way to cut a generation short.
5. **`Grounded` / `SEEKER` badges are cryptic.** Unexplained internal jargon;
   "SEEKER" is an engine codename users don't need.
6. **Send affordance reads as a status LED.** The 12px dot inside the 44px
   target gives no directional "send" signal (hit target itself is fine).
7. **Composer auto-grow can cover the latest reply's tail.** The textarea
   auto-grows up to 200px (`composer.tsx` auto-grow effect) but the transcript
   never re-pins when the composer's height changes, so a grown composer
   overlays the last lines of the newest reply (the sticky band's fade buffer
   is sized for the single-line composer). Residual from feat-267's
   restructure — see
   `docs/solutions/ui-bugs/sticky-overlay-scroll-container-pointer-events-scroll-padding.md`.
8. **Favicon PNG fallback for Safari.** feat-267 shipped an SVG-only favicon
   (`icons: { icon: "/brand/jfp-sign.svg" }` in `layout.tsx`) — Safari does
   not render SVG favicons, so Safari tabs show nothing. One-line fix once
   the asset exists. **ASK THE OWNER (jian wei) FOR A PNG** of the JFP flag
   mark (32x32 or 48x48, transparent background) before starting this item —
   do not auto-convert the SVG without sign-off on the rendering.

## Entry Points — Read These First

1. `apps/chat/src/components/shell/app-shell.tsx` — owns `mobileOpen` +
   renders the floating `Open menu` button (item 1); owns conversation state
   wiring (item 2).
2. `apps/chat/src/lib/use-conversations.ts` — `newConversation` (item 2: no-op
   or reuse when the active conversation is empty; don't list empty locals),
   the hydration merge (item 3: a non-empty client-derived title should not be
   displaced by an EMPTY server title's date fallback; consider one delayed
   title refetch after a thread's first reply), and the per-conversation
   `AbortController` slot (item 4: the plumbing for a stop button already
   exists — wire a visible control to it and make sure an aborted turn
   finalizes with the partial text kept, not the failure notice).
3. `apps/chat/src/components/chat/composer.tsx` — item 4's stop control
   replaces the send dot while `pending`; item 6's directional glyph when
   `canSend`.
4. `apps/chat/src/components/chat/message-list.tsx` — items 5: badge copy +
   `title`/tooltip text; drop or rename the engine marker.
5. `apps/chat/src/components/shell/sidebar-conversation-list.tsx` — item 2's
   row rendering.

## Grep These

- `Open menu` — the floating mobile button.
- `fallbackTitle` + `deriveTitle` — the title precedence seam (item 3).
- `AbortController` in `use-conversations.ts` — the stop plumbing (item 4).
- `Grounded` / `SEEKER` in `message-list.tsx` — badge copy (item 5).
- `size-3 rounded-full` in `composer.tsx` — the send dot (item 6).

## What To Build

- Mobile-only sticky top bar (menu button + brand lockup) OR top padding on
  the transcript that clears the floating button — pick during implementation;
  the bar is preferred (gives mobile a brand anchor and a future title slot).
- New-conversation: reuse the existing empty conversation (focus the composer)
  instead of minting another; exclude never-used empty conversations from the
  sidebar list (the pinned fresh row stays).
- Title precedence: local non-empty snippet title wins over the server date
  fallback for threads the client already knows; server LLM title (non-empty)
  still wins over everything.
- Stop button: while `pending`, the composer's send slot becomes a stop
  control wired to the conversation's `AbortController`; aborting keeps the
  partial reply text (finalize, no `role="alert"` failure notice) and
  re-enables the composer.
- Badges: replace `SEEKER` with nothing (or "AI answer" copy if a marker must
  stay); give `Grounded`/`Ungrounded` a `title` tooltip one-liner ("Answer
  drawn from the cited sources below" / "No sources were available for this
  answer").
- Send affordance: directional glyph (inline SVG arrow, `shell/icons.tsx`
  pattern) shown when `canSend`, replacing or overlaying the dot.
- Auto-grow re-pin: when the composer block's height changes (ResizeObserver
  on the sticky band, or a callback from the auto-grow effect), re-pin
  `scrollTop = scrollHeight` ONLY when the user was already at/near the
  bottom — never yank a user who scrolled up. Re-size the scroller's
  `[scroll-padding-bottom:13rem]` if the band's resting height changes.
- Favicon fallback: add the user-provided PNG to `public/brand/` and extend
  `layout.tsx` metadata to `icons: { icon: [{ url: "/brand/jfp-sign.svg" },
{ url: "/brand/jfp-sign-32.png", sizes: "32x32" }] }` (SVG stays primary;
  PNG covers Safari). Blocked on the asset — see Problem item 8.

## Constraints

- One PR per the batch is fine, but keep commits per-item so review maps to
  the list above.
- No design-system additions (no icon package, no new tokens).
- Item 4 must not touch the server proxy — the abort is client-side; the
  upstream request termination via the fetch signal is already the seam's
  behavior.
- The R22 send-blocking states in the composer (replay loading/unavailable)
  must keep their notices; the stop control only appears for `pending`.

## Verification

```bash
pnpm --filter @forge/chat typecheck && pnpm --filter @forge/chat lint && pnpm --filter @forge/chat test
```

- Behavioral tests: new-conversation no-op on an empty active conversation;
  title precedence merge cases; abort keeps partial text and re-enables send;
  badge copy.
- Browser (desktop + 390px): no content under the mobile menu button; a
  20s-plus Seeker stream stopped mid-flight keeps its partial text; sidebar
  shows at most one fresh empty row.
