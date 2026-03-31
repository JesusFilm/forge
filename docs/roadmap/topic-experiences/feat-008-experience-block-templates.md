---
id: "feat-008"
title: "Experience Block Template System"
owner: "ekkasit"
priority: "P0"
status: "not-started"
start_date: "2026-04-07"
duration: 21
depends_on:
  - "feat-001"
blocks:
  - "feat-013"
tags:
  - "manager"
  - "cms"
---

## Entry Points — Read These First

1. `apps/cms/src/api/experience/content-types/experience/schema.json` — Experience schema with `sections` dynamic zone
2. `apps/cms/schema.graphql` — search for `enum Enum_Componentsharedsection_Component` or grep `ComponentSection` to find all 14 block type names
3. `apps/cms/src/components/sections/` — list this directory to see all section component schemas
4. `apps/web/src/components/sections/` — how blocks render on web (tells you which fields are actually used)
5. `apps/mobile/src/components/sections/` — how blocks render on mobile

## Grep These

- `__component.*sections\.` in `apps/cms/` — how dynamic zone components are referenced
- `ComponentSection` in `apps/cms/schema.graphql` — all block type definitions with their fields
- `SectionRenderer` or `renderSection` in `apps/web/src/` and `apps/mobile/src/` — how blocks are dispatched to renderers

## What To Build

1. New file: `apps/manager/src/templates/experienceTemplates.ts`

   ```typescript
   export type BlockSlot = {
     component: string // Strapi component name, e.g. "sections.video-hero"
     purpose: string // human+LLM readable: "Featured video for the topic"
     required: boolean
     config?: Record<string, unknown> // static config values for this slot
   }

   export type ExperienceTemplate = {
     id: string // e.g. "topic-standard"
     name: string
     description: string // for LLM context: "A standard topic page with hero, intro, video collection, and related questions"
     slots: BlockSlot[]
   }

   export const TEMPLATES: ExperienceTemplate[] = [
     {
       id: "topic-standard",
       name: "Standard Topic Page",
       description:
         "A topic overview page featuring a hero video, introduction text, curated video collection, related questions, and a call to action",
       slots: [
         {
           component: "sections.video-hero",
           purpose: "Featured video that best represents this topic",
           required: true,
         },
         {
           component: "sections.text",
           purpose: "Topic introduction paragraph (2-3 sentences)",
           required: true,
         },
         {
           component: "sections.media-collection",
           purpose: "Collection of related videos for this topic",
           required: true,
         },
         {
           component: "sections.related-questions",
           purpose: "3-5 questions people ask about this topic",
           required: false,
         },
         {
           component: "sections.cta",
           purpose: "Next steps — link to related topics or deeper content",
           required: false,
         },
       ],
     },
     // Add more templates...
   ]
   ```

2. Define at least 3 templates:
   - `topic-standard` — standard topic page (5-6 blocks)
   - `topic-deep-dive` — longer page for topics with many videos (8+ blocks, multiple media collections)
   - `topic-minimal` — short page for topics with few videos (3 blocks: hero, text, small collection)

3. Template selection logic:
   ```typescript
   export function selectTemplate(cluster: TopicCluster): ExperienceTemplate
   ```
   Based on: video count (< 5 → minimal, 5-15 → standard, > 15 → deep-dive), hierarchy level (parent topics get deep-dive).

## Constraints

- Templates are plain TypeScript objects, NOT a Strapi content type. Keep them in code — they change with the codebase, not with editorial decisions.
- Only use `__component` values that actually exist. Verify against `ls apps/cms/src/components/sections/`.
- Do NOT invent new block types. Use only existing section components.
- The `purpose` field is consumed by the LLM in Vlad's Feature 3 — write it as a clear instruction.

## Verification

- Every `slots[].component` value matches a directory in `apps/cms/src/components/sections/`
- `selectTemplate({ videoIds: [1,2,3], ... })` returns `topic-minimal`
- `selectTemplate({ videoIds: Array(20).fill('x'), ... })` returns `topic-deep-dive`
- Template slot count matches what the web/mobile renderers can handle
