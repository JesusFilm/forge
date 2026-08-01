---
title: "Route-aware content in shared Watch Experience templates"
date: "2026-08-01"
category: architecture-patterns
module: watch
problem_type: architecture_pattern
component: tooling
severity: medium
applies_when:
  - "One shared Experience layout must render entity-specific content on many Watch routes"
  - "Generated content needs editorial publication rules and a safe empty-data behavior"
  - "A route-aware block must preserve existing manual Experience behavior"
tags:
  - "watch"
  - "experience-template"
  - "route-context"
  - "generated-content"
  - "atomic-fallback"
  - "graphql"
  - "prisma"
---

# Route-aware content in shared Watch Experience templates

## Context

A common single-video Experience solves layout duplication, but an authored
FAQ inside that Experience is still identical on every Video route. The
existing source study questions could not simply fill the footer: they contain
prompts without generated answers, are owned by Core sync, and already appear
in the canonical Watch body.

The scalable boundary is one shared layout plus route-owned, published content.
The route supplies data; the Experience remains the presentation authority.
This keeps new Videos eligible without creating one Experience per Video or
running AI during a public request.

## Guidance

### Separate generated content from source grounding

Persist generated Q&A separately from Core-owned study prompts. Keep a required
grounding relation so provenance and editorial lifecycle do not mutate the
source rows. If the grounding must belong to the same Video, enforce that
invariant in the database with a composite relation, not only in application
validation:

```prisma
model VideoStudyQuestion {
  id      String
  videoId String

  @@unique([id, videoId])
}

model VideoGeneratedQuestion {
  videoId               String
  sourceStudyQuestionId String

  sourceStudyQuestion VideoStudyQuestion
    @relation(fields: [sourceStudyQuestionId, videoId], references: [id, videoId])
}
```

The generated record owns localized question and answer text, order, review
status, publication and deletion state, and generation provenance. Public reads
include only published, non-deleted, nonblank rows; authorized editor reads can
inspect non-deleted drafts.

### Select one locale tier before rendering

Load exact-language, broader-locale, and English buckets through the existing
server-side Watch snapshot. Select the first non-empty eligible bucket as a
complete set. Do not mix tiers, because a mixed FAQ can silently combine
languages and review states.

### Make route sourcing explicit and backward compatible

Give the existing block an explicit source mode:

```ts
type QuestionsSource = "manual" | "routeVideoGeneratedQuestions"
```

Default to `manual` so every existing Experience keeps its authored behavior.
The route variant receives the selected Q&A through the existing `RouteVideo`
render context. It does not issue a browser-side Admin request and does not
invoke a generator.

### Use an atomic authored fallback

Choose either the complete generated set or the complete authored set:

```ts
const questions =
  questionsSource === "routeVideoGeneratedQuestions" &&
  routeVideo.generatedQuestions.length > 0
    ? routeVideo.generatedQuestions
    : authoredQuestions
```

Do not merge the lists. Atomic fallback avoids mixed tone, duplicate prompts,
ambiguous ordering, and partially generated pages. It also makes an empty
additive migration safe: existing routes immediately render the template's
authored questions.

### Keep route state and payload ownership narrow

Key interactive disclosure state to the route Video identity so navigating
between Videos cannot resurrect an answer opened on a previous route. Carry
the selected generated list once, on the route context used by Experience
blocks; prune it from player, body, and sharing payloads that do not consume it.

For responsive containers built on a 12-column grid, remember that horizontal
gap applies between all 12 tracks. When every slot spans all columns below the
desktop breakpoint, use zero horizontal track gap and a separate vertical gap;
otherwise eleven mobile gaps can exceed the viewport even when each child uses
`min-width: 0`.

## Why This Matters

This pattern separates three concerns that otherwise drift together:

- The shared Experience controls reusable layout and calls to action.
- The route Video controls which reviewed content is eligible.
- The authored block controls the complete no-data fallback.

The result is safe to deploy before a production writer exists, preserves
manual Experiences, keeps public requests free of AI work, and avoids widening
the browser dependency graph. Database-enforced same-Video grounding also
prevents a future writer from attaching a valid study question from the wrong
Video.

## When to Apply

- A common page template needs entity-specific FAQ, recommendations, devotional
  material, or other supplemental content.
- Generated output must be reviewed and published independently of its source
  material.
- Empty or partially populated production data must not make a route blank or
  unhealthy.
- Existing manually authored blocks must retain their semantics by default.

Do not use this pattern when each page genuinely needs a different layout. In
that case, explicit Experiences remain the appropriate presentation model.

## Examples

The local fixture demonstrates the contract with one shared template:

- Jesus Feature Film selects two published generated Q&A items.
- Easter Explained selects a different published Q&A item.
- My Last Day has no generated items and selects both authored fallback items.

Browser verification should cover all three routes, open an answer, navigate
away and back to prove disclosure reset, inspect the request log for the absence
of a client Admin fetch, and check mobile document width. Migration verification
should attempt both a valid same-Video grounding row and an invalid cross-Video
row in an isolated schema.

## Related

- [Watch Single-Video Template Pages with Strapi Settings and Next.js Route Resolution](../best-practices/watch-single-video-template-pages-strapi-nextjs-2026-04-11.md) — architectural predecessor; the current Admin-owned implementation extends its explicit route-binding idea with persisted Q&A, publication policy, and atomic fallback.
- [Admin-owned Watch route manifest](admin-owned-watch-route-manifest-20260530.md) — distinguishes route admission data from rendering payloads.
- [Implementation plan](../../plans/2026-08-01-001-feat-watch-route-video-questions-plan.md)
- [Roadmap feature](../../roadmap/topic-experiences/feat-323-watch-route-video-generated-questions.md)
