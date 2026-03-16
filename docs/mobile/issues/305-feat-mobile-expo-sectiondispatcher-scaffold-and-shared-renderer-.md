---
artifactType: issue
issueNumber: 305
issueTitle: "feat(mobile-expo): SectionDispatcher scaffold and shared renderer types"
issueUrl: "https://github.com/JesusFilm/forge/issues/305"
state: "CLOSED"
closedAt: "2026-03-09T23:17:01Z"
labels: []
linkedPrs: []
scope: "mobile"
---

# Issue Artifact: #305

## Background

The Expo watch app renders server-driven UI by mapping each CMS section type to a React Native component. Before individual renderers can be built, the app needs a dispatcher that switches on `__typename` and shared types/props interfaces that all renderers conform to.

This is the foundation sub-issue of #93. Every subsequent renderer sub-issue plugs a real component into the dispatcher in place of a placeholder stub.

## Expected outcome

- A `SectionDispatcher` component that receives a section object (with `__typename`) and renders the matching renderer.
- Placeholder/stub components for all 10 section types so the dispatcher compiles and renders fallback UI for unimplemented types.
- Shared TypeScript types/interfaces for section props, aligned with the data layer models from #304.
- File structure under `mobile/expo/.../sections/` with one file per renderer (stubs) and the dispatcher.

## Acceptance criteria

- [ ] `SectionDispatcher` component switches on `__typename` and renders the correct component.
- [ ] Placeholder stubs exist for all 10 types: VideoHero, MediaCollection, CTA, Text, Video, BibleQuotesCarousel, RelatedQuestions, Card, Section, Container.
- [ ] Stubs render a visible fallback (e.g. type name label) so missing renderers are obvious during development.
- [ ] Shared props interfaces exported for each section type.
- [ ] Dispatcher handles unknown `__typename` gracefully (e.g. logs warning, renders nothing).
- [ ] File structure: `mobile/expo/.../sections/{SectionDispatcher, VideoHero, MediaCollection, ...}`.

## Possible solution(s)

1. Simple switch/map object in SectionDispatcher: `{ ComponentSectionsVideoHero: VideoHeroRenderer, ... }`.
2. Each stub exports a component matching the shared interface; real implementations replace stubs in subsequent issues.

## References

- Parent: #93 (tracking issue for all section renderers)
- Depends on: #304 (expanded data layer — provides typed section models)
- [apps/cms/schema.graphql](apps/cms/schema.graphql) — `ExperienceSectionsDynamicZone` union (line 693)

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
