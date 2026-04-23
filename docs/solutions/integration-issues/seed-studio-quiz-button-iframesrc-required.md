---
title: Seed Studio quiz-button save fails — iframeSrc required by Strapi schema
category: integration-issues
date: 2026-04-22
tags:
  - seed-studio
  - strapi
  - cms
  - validation
  - llm-generation
related_paths:
  - apps/seed-studio/src/lib/ai/generator.server.ts
  - apps/seed-studio/src/app/api/chat/route.ts
  - apps/seed-studio/src/lib/ai/experience-schema.ts
  - apps/cms/src/components/sections/quiz-button.json
---

## Problem

"Save to Strapi" in Seed Studio failed with a Yup validation error:

```
blocks.3.content.3.iframeSrc: blocks[3].content[3].iframeSrc must be a `string` type, but the final value was: `null`.
```

Seed Studio generated a `sections.quiz-button` component containing only `buttonText`, but the Strapi schema requires `iframeSrc` as a non-null string.

## Root cause

Contract mismatch between Seed Studio's deterministic section builders and the Strapi `sections.quiz-button` component schema. The builders in `generator.server.ts` emitted quiz-button blocks with just `buttonText`, and the schema (`apps/cms/src/components/sections/quiz-button.json`) declares `iframeSrc` as `required: true` with a regex constraint (`^https://[\w.-]+\.nextstep\.is/.*$`). The LLM wasn't asked for the field either, so it was never populated.

## Solution

Provide a default `iframeSrc` at every quiz-button emission site, extend the TS type, and teach the LLM via the example in the system prompt.

**1. `apps/seed-studio/src/lib/ai/generator.server.ts`** — add a default and include it in both builders:

```ts
const DEFAULT_QUIZ_IFRAME_SRC =
  "https://your.nextstep.is/embed/default?expand=false"

// both quiz-button emission sites:
{
  __component: "sections.quiz-button",
  buttonText: block.quizButtonText ?? "Take the quiz",
  iframeSrc: DEFAULT_QUIZ_IFRAME_SRC,
}
```

**2. `apps/seed-studio/src/lib/ai/experience-schema.ts`** — add the field to the type:

```ts
export type QuizButtonSection = {
  __component: "sections.quiz-button"
  buttonText: string
  iframeSrc: string
}
```

**3. `apps/seed-studio/src/app/api/chat/route.ts`** — update the JSON example in the system prompt so the LLM sees the correct shape:

```json
{
  "__component": "sections.quiz-button",
  "buttonText": "Take the Quiz",
  "iframeSrc": "https://your.nextstep.is/embed/default?expand=false"
}
```

## Verification

1. Start CMS + Seed Studio: `pnpm --filter @forge/cms dev` and `pnpm --filter seed-studio dev`
2. Generate an experience that includes a quiz-button section
3. Click **Save to Strapi** — publish action returns 200, page viewable at `localhost:3000/watch/<slug>`

## Prevention

When adding or changing a Strapi component with required fields, update the Seed Studio surface in three places together: builders in `generator.server.ts`, TS types in `experience-schema.ts`, and the example JSON in the chat route's system prompt. A CI-side contract test that validates a sample generated payload against the Strapi component schemas would catch this class of drift before it hits runtime.
