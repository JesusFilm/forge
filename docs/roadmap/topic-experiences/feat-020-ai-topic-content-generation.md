---
id: "feat-020"
title: "AI Topic Content Generation Service"
owner: "vlad"
priority: "P2"
status: "not-started"
start_date: "2026-04-28"
duration: 28
depends_on:
  - "feat-007"
blocks:
  - "feat-013"
tags:
  - "manager"
  - "ai-pipeline"
  - "cms"
---

## Entry Points — Read These First

1. `apps/manager/src/services/metadata.ts` — pattern for LLM service: `getOpenrouter().chat.completions.create()` with structured JSON output
2. `apps/cms/src/api/experience/content-types/experience/schema.json` — Experience schema, this is the target output shape
3. `apps/cms/schema.graphql` — search for `ComponentSection` to see all 14 block types and their fields
4. `apps/manager/src/lib/openrouter.ts` — shared OpenRouter client

## Grep These

- `ComponentSection` in `apps/cms/schema.graphql` — all section block type definitions
- `dynamiczone` in `apps/cms/src/api/experience/` — the sections field definition
- `response_format.*json` in `apps/manager/src/services/` — existing structured output pattern

## What To Build

1. New file: `apps/manager/src/services/topicContent.ts`

   ```typescript
   export type TopicCluster = {
     topicName: string
     topicDescription: string
     videoIds: string[]
     videoMetadata: Array<{
       id: string
       title: string
       description: string
       topics: string[]
     }>
   }

   export type GeneratedExperienceContent = {
     title: string
     slug: string
     metaDescription: string
     ogTitle: string
     ogDescription: string
     sections: Array<{
       __component: string // e.g. "sections.video-hero", "sections.text"
       [key: string]: unknown // block-specific fields
     }>
   }

   export async function generateTopicPageContent(
     cluster: TopicCluster,
     template: ExperienceTemplate,
   ): Promise<GeneratedExperienceContent>
   ```

2. LLM prompt that takes a topic cluster + template and produces structured Experience content. Output must be valid Strapi dynamic zone data.

3. Expose as API route: `POST /api/generate-topic-content` — Ekkasit's pipeline calls this.

## Constraints

- Do NOT generate content that makes theological claims beyond what's in the source video transcripts. The LLM summarizes and organizes existing content, not inventing doctrine.
- Do NOT hardcode block types. Read the template to determine which `__component` values to generate.
- Output must be directly writable to Strapi — match the dynamic zone format exactly.
- Follow the existing OpenRouter pattern in `metadata.ts`. Do not add new AI providers.

## Verification

- Call with a test cluster of 5 videos on "Forgiveness" → returns valid `GeneratedExperienceContent`
- Every `sections[].___component` value matches a real Strapi component name (grep `apps/cms/src/components/sections/`)
- POST the output to Strapi's Experience create API → Experience is created and renderable

## Success Criteria

- Given a topic cluster, generates coherent Experience page content
- Output is directly writable to Strapi without transformation
- Content is grounded in source video metadata, not hallucinated
- Ekkasit's pipeline can call the API endpoint programmatically
