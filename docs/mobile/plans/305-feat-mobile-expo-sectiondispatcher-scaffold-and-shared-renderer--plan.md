---
artifactType: plan
sourceIssueNumber: 305
sourceIssueTitle: "feat(mobile-expo): SectionDispatcher scaffold and shared renderer types"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/305"
linkedPrs: []
scope: "mobile"
---

# Plan Artifact: #305

## Objective

- A `SectionDispatcher` component that receives a section object (with `__typename`) and renders the matching renderer.
- Placeholder/stub components for all 10 section types so the dispatcher compiles and renders fallback UI for unimplemented types.
- Shared TypeScript types/interfaces for section props, aligned with the data layer models from #304.
- File structure under `mobile/expo/.../sections/` with one file per renderer (stubs) and the dispatcher.

## Planned approach

1. Simple switch/map object in SectionDispatcher: `{ ComponentSectionsVideoHero: VideoHeroRenderer, ... }`.
2. Each stub exports a component matching the shared interface; real implementations replace stubs in subsequent issues.

## Validation

- [ ] `SectionDispatcher` component switches on `__typename` and renders the correct component.
- [ ] Placeholder stubs exist for all 10 types: VideoHero, MediaCollection, CTA, Text, Video, BibleQuotesCarousel, RelatedQuestions, Card, Section, Container.
- [ ] Stubs render a visible fallback (e.g. type name label) so missing renderers are obvious during development.
- [ ] Shared props interfaces exported for each section type.
- [ ] Dispatcher handles unknown `__typename` gracefully (e.g. logs warning, renders nothing).
- [ ] File structure: `mobile/expo/.../sections/{SectionDispatcher, VideoHero, MediaCollection, ...}`.

## Source links

- Issue: [#305](https://github.com/JesusFilm/forge/issues/305)
- PRs:
- None
