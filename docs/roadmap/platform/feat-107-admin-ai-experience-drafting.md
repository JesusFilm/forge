---
id: "feat-107"
title: "Admin AI Experience Drafting"
owner: "tataihono"
priority: "P1"
status: "in-progress"
start_date: "2026-04-23"
duration: 10
depends_on:
  - "feat-103"
blocks: []
tags:
  - "platform"
  - "admin"
  - "cms"
  - "editor"
  - "experience"
  - "ai"
---

## Problem

The admin experience editor can now model and edit the full block system, but
creating a first draft is still a manual empty-canvas exercise. Editors who
already know the theme or story they want still have to add blocks one by one,
write the title and description themselves, and manually wire video picks into
the canvas. The product needs a prompt-first authoring path inside `apps/admin`
so an editor can describe the story they want and receive an editable first
draft composed from the existing admin block model.

## Entry Points — Read These First

1. `apps/admin/AGENTS.md`
2. `apps/admin/CLAUDE.md`
3. `apps/admin/src/app/dashboard/experiences/[id]/page.tsx`
4. `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`
5. `apps/admin/src/app/dashboard/experiences/experience-editor/block-helpers.ts`
6. `apps/admin/src/domain/blocks.ts`
7. `apps/admin/src/services/experience.service.ts`
8. `apps/admin/src/services/embeddings.service.ts`
9. `docs/solutions/best-practices/nextjs-server-action-llm-structured-output-pattern-2026-04-21.md`

## Grep These

- `Empty Canvas|Start with a first block|Browse All Blocks` in `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`
- `"use server"|revalidatePath|saveLocaleAction|publishLocaleAction` in `apps/admin/src/app/dashboard/experiences/[id]/page.tsx`
- `BlockSchema|BlocksSchema|SectionContentBlockSchema|ContainerContentBlockSchema` in `apps/admin/src/domain/blocks.ts`
- `VideoLibraryItem|loadVideoRows|previewStreamUrl|previewImageUrl` in `apps/admin/src/app/dashboard`
- `OPENROUTER_API_KEY|OPENAI_API_KEY|OPENAI_BASE_URL` in `apps/admin/src/config/env.ts`

## What To Build

1. Add a `Generate with AI` flow to the empty-canvas state of the admin
   experience editor so an operator can enter a theme, story, or angle and
   receive an editable first draft.
2. Keep the generation path admin-native:
   - generate `title`
   - generate `metaDescription`
   - generate top-level and nested blocks that normalize into
     `apps/admin/src/domain/blocks.ts`
   - do **not** call Seed Studio at runtime or import from another app context
3. Keep video and media picks constrained to the real editorial catalog only.
   The model may choose only from server-provided candidate videos; it must not
   invent external streaming URLs or raw video references.
4. Make v1 empty-canvas only. If the locale already has blocks, the AI entry
   point should be hidden or disabled. Do not merge into existing block trees in
   this ticket.
5. Keep generation ephemeral until the editor saves. `Generate with AI` should
   populate local editor state, but it must not write to the database or publish
   automatically.
6. Let the provider-facing schema cover every block type the admin editor
   supports, but normalize the model output through a server-owned mapper before
   validating with `BlocksSchema`.
7. Reuse the existing admin provider/env posture (`OPENROUTER_API_KEY` first,
   `OPENAI_API_KEY` fallback) and existing editor permissions (`write:experiences` /
   locale edit checks).

## Constraints

- Keep scope inside `apps/admin` plus roadmap/plan/docs updates.
- Preserve the admin architecture boundary: UI -> server actions/services ->
  Prisma. No client-side provider calls.
- Do not change the canonical saved block schema just to make the model easier
  to prompt. Introduce a model-facing draft schema if needed, then normalize
  into `BlocksSchema`.
- Do not auto-save, auto-publish, or overwrite an already non-empty canvas.
- Do not import runtime code from `apps/seed-studio`, `apps/web`, `apps/mobile`,
  `apps/mobile-v2`, `apps/cms`, or `apps/manager`.
- Keep slug/path routing edits manual in v1 unless a separate, explicit slug
  policy is added in the same ticket.

## Verification

- `pnpm --filter @forge/admin lint`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin test`
- Browser check of `/dashboard/experiences/[id]`:
  - empty canvas shows `Generate with AI`
  - prompt submission shows loading/error/success states
  - successful generation fills title/description/blocks without saving
  - generated video blocks only reference catalog-backed items
