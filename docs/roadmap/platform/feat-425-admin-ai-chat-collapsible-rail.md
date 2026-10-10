---
id: "feat-425"
title: "Admin AI Chat Collapsible Rail"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-08-26"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "admin"
  - "ui"
  - "experience"
---

## Problem

The admin experience editor devotes a fixed 380px left rail to the AI Chat on
every page load, even for editors who are doing manual block work and never
open the chat. On the Watch experiences the canvas is the wide surface that
needs the room. The rail needs a collapsed default and a cheap way back.

## Entry Points — Read These First

1. `apps/admin/CLAUDE.md`
2. `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx`
3. `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.test.tsx`
4. `apps/admin/src/app/dashboard/experiences/experience-editor-with-chat.tsx`

## Grep These

- `experience-chat-panel` in `apps/admin/src/app/dashboard/experiences/`
- `experience-chat-expand` / `experience-chat-collapse` (the two toggles)
- `defaultCollapsed` in `experience-chat-panel.tsx`
- `w-\[380px\]` in `experience-chat-panel.tsx`

## What To Build

1. `defaultCollapsed` prop on `ExperienceChatPanel`, defaulting to `true`, so
   the editor page opens with the canvas at full width.
2. Collapsed state renders the `<aside>` as a narrow strip (`w-11`) whose whole
   surface is the expand button: brand badge, vertical "AI CHAT" label, chevron,
   plus a pulsing dot while chat/generation work is in flight.
3. Expanded state keeps the existing 380px panel and adds a collapse control in
   the header beside "New".
4. Hide the panel body with the `hidden` attribute + class — never unmount it —
   so threads, an unsent draft, and an in-flight stream survive a collapse and
   re-expand does not refetch.
5. `aria-expanded` / `aria-controls` on both toggles, and focus hand-off to the
   counterpart control on each toggle.

## Constraints

- Keep scope inside `apps/admin`.
- No new design tokens, no new colors, no gradients.
- Do not unmount the panel body on collapse (loses stream + draft state).
- Do not change chat API, persistence, streaming, or editor mutation behavior.
- No collapse-state persistence — collapsed is the default on every mount.

## Verification

- `pnpm --filter @forge/admin exec vitest run src/app/dashboard/experiences/`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin exec eslint --max-warnings=0 src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx src/app/dashboard/experiences/experience-editor/experience-chat-panel.test.tsx`
- Browser smoke: open `/dashboard/experiences/[id]?locale=en`, confirm the rail
  starts as the narrow strip, expand → 380px panel, type a draft, collapse and
  re-expand → the draft is still there, and the message list is pinned to the
  bottom on expand.
- Keyboard smoke: Tab reaches the collapsed rail, Enter expands and focus lands
  on the collapse control, Enter again collapses and focus returns to the rail.

## Resolution

Shipped 2026-08-26 in `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx`.
Two review findings were fixed in the same change and are the non-obvious part
of this surface:

- The scroll-to-bottom and staged-draft `scrollIntoView` effects take
  `collapsed` as a dependency. A `display:none` list measures
  `scrollHeight === 0`, so without it a thread re-opened scrolled to its oldest
  message.
- Each toggle hides the subtree containing itself, so both hand focus to the
  counterpart control via a toggle-armed latch (the latch keeps first paint
  from stealing focus).

See `docs/solutions/logic-errors/hidden-subtree-breaks-measuring-effects-and-focus.md`.
