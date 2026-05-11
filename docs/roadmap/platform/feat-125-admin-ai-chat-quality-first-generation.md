---
id: "feat-125"
title: "Admin AI Chat Quality-First Generation"
owner: "ekkasit"
priority: "P1"
status: "in-progress"
start_date: "2026-05-11"
duration: 5
depends_on: []
blocks: []
tags:
  - "platform"
  - "admin"
  - "experience"
  - "ai-pipeline"
---

## Problem

The Admin Experience AI Chat can generate or refine page content, but zero-state
generation still risks producing a generic AI draft from a thin prompt. Editors
need the chat to first shape a usable editorial brief, then generate a draft
through the Christian content creator guidance so the output is grounded,
reviewable, and closer to publishable quality.

## Entry Points — Read These First

1. `docs/brainstorms/2026-05-11-admin-ai-chat-quality-first-generation-requirements.md`
2. `docs/brainstorms/2026-05-08-admin-experience-ai-chat-panel-requirements.md`
3. `docs/plans/2026-05-08-001-feat-admin-experience-ai-chat-panel-plan.md`
4. `content-creator-agent-kit.tgz`
5. `apps/admin/AGENTS.md`
6. `apps/admin/CLAUDE.md`
7. `apps/admin/src/services/experience-ai/experience-ai-chat-prompts.ts`
8. `apps/admin/src/services/experience-ai/experience-ai-chat.service.ts`
9. `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx`

## Grep These

- `buildChatPrompt` in `apps/admin/src/services/experience-ai/experience-ai-chat-prompts.ts`
- `isFirstDraftPrompt` in `apps/admin/src/services/experience-ai/experience-ai-chat.service.ts`
- `openrouter/free` in `apps/admin/src`
- `OPENROUTER_API_KEY` in `apps/admin/src/config/env.ts`
- `ExperienceChatPanel` in `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx`
- `content creator` in `docs/brainstorms/`

## What To Build

1. Add a guided brainstorm mode for empty-canvas full-create requests.
2. Require an editor-confirmed editorial brief before generating from zero.
3. Use the content creator kit guidance to improve Scripture grounding,
   ecumenical boundaries, Thai/English editorial voice, page structure, review,
   and reference tracking.
4. Keep public canvas output limited to page content while preserving research
   notes and reference ledger for admin/editor review.
5. Move the full-create generation provider path to OpenRouter free-tier:
   pinned free models first, with `openrouter/free` fallback.
6. Preserve lightweight edit/refine behavior for populated canvases unless the
   editor explicitly asks for a re-brief or full regeneration.

## Constraints

- Do not auto-generate from an empty canvas before the editor confirms the
  brief.
- Do not show research notes or reference ledger on the public Experience page
  by default.
- Do not make every small chat refinement run the heavy quality workflow.
- Do not use Codex as the primary provider for the v1 full-create path.
- Do not hardcode a free model choice without a planning-time availability and
  quality check.

## Verification

- Empty-canvas create requests enter guided brainstorm mode and do not mutate
  the canvas before brief confirmation.
- The confirmed brief includes topic or passage, language, audience, desired
  outcome, tone, page type, Scripture emphasis, and CTA or next step.
- After confirmation, draft generation uses OpenRouter free-tier provider
  routing and preserves the brief if all provider attempts fail.
- Generated public page content can be previewed/applied without inserting a
  public reference section.
- Populated-canvas copy refinements still run as lightweight chat edits.
