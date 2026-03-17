---
artifactType: plan
sourceId: 305
sourceTitle: "feat(mobile-expo): SectionDispatcher scaffold and shared renderer types"
linkedPrs: []
scope: "mobile"
---

# Plan Artifact: "feat(mobile-expo): SectionDispatcher scaffold and shared renderer types"

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

## References

- Parent: #93 (tracking issue for all section renderers)
- Depends on: #304 (expanded data layer — provides typed section models)
- [apps/cms/schema.graphql](apps/cms/schema.graphql) — `ExperienceSectionsDynamicZone` union (line 693)

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
