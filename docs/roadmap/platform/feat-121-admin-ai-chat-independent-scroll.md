---
id: "feat-121"
title: "Admin AI Chat Independent Scroll"
owner: "ekkasit"
priority: "P2"
status: "in-progress"
start_date: "2026-05-10"
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

The admin experience editor AI Chat rail can grow with its message history,
which makes the main page carry chat overflow. Editors need the AI Chat
transcript to scroll independently so the chat header/composer stay available
while the main experience canvas keeps its own page-level scroll behavior.

## Entry Points — Read These First

1. `apps/admin/AGENTS.md`
2. `apps/admin/CLAUDE.md`
3. `apps/admin/src/app/dashboard/experiences/experience-editor-with-chat.tsx`
4. `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx`
5. `apps/admin/src/components/admin-shell.tsx`
6. `docs/plans/2026-05-10-001-fix-admin-chat-independent-scroll-plan.md`

## Grep These

- `ExperienceEditorWithChat` in `apps/admin/src/app/dashboard/experiences/experience-editor-with-chat.tsx`
- `experience-chat-message-list` in `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx`
- `h-12` in `apps/admin/src/components/admin-shell.tsx`

## What To Build

1. Constrain the AI Chat rail to the viewport below the admin shell header.
2. Keep the rail header and composer outside the scrollable transcript area.
3. Make the transcript/message area independently scroll with `overflow-y-auto`.
4. Preserve the existing fixed-width desktop layout and all chat behavior.

## Constraints

- Keep scope inside `apps/admin` and this roadmap ticket.
- Do not change Prisma schema, GraphQL schema, API routes, or chat persistence.
- Reuse existing Forge admin tokens and Tailwind composition; do not introduce new colors.
- Keep mobile/narrow viewport behavior out of scope for this fix.

## Verification

- `pnpm --filter @forge/admin test -- src/app/dashboard/experiences/experience-editor/experience-chat-panel.test.tsx`
- `pnpm --filter @forge/admin typecheck`
- Browser smoke: open `/dashboard/experiences/[id]?locale=en`, create or load enough chat messages to overflow the panel, confirm the AI Chat transcript scrolls without moving the main editor page and the chat composer remains visible.
