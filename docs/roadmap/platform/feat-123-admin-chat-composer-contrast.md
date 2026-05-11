---
id: "feat-123"
title: "Admin Chat Composer Contrast"
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

The AI Chat composer at the bottom of the admin experience editor blends into
the dark lower edge of the page. The textarea and disabled Send button are hard
to see, especially when the chat transcript is long and the user is focused on
the bottom composer.

## Entry Points — Read These First

1. `apps/admin/AGENTS.md`
2. `apps/admin/CLAUDE.md`
3. `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx`
4. `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.test.tsx`
5. `docs/plans/2026-05-10-003-fix-admin-chat-composer-contrast-plan.md`

## Grep These

- `experience-chat-composer` in `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx`
- `experience-chat-input` in `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx`
- `experience-chat-send` in `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx`

## What To Build

1. Give the AI Chat composer a solid token-backed surface.
2. Make the textarea background and border visibly distinct from the bottom panel.
3. Make disabled Send visible as a disabled control rather than a faded brand button.
4. Preserve all chat behavior and existing layout.

## Constraints

- Keep scope inside `apps/admin`.
- Do not add new colors or design tokens.
- Do not add decorative gradients.
- Do not change chat API, persistence, streaming, or editor mutation behavior.

## Verification

- `pnpm --filter @forge/admin test -- src/app/dashboard/experiences/experience-editor/experience-chat-panel.test.tsx`
- `pnpm --filter @forge/admin exec eslint src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx src/app/dashboard/experiences/experience-editor/experience-chat-panel.test.tsx`
- Browser smoke: open `/dashboard/experiences/[id]?locale=en` and confirm the bottom chatbox remains visible without a gradient/fade effect.
