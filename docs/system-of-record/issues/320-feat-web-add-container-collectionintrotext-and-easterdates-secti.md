---
artifactType: issue
issueNumber: 320
issueTitle: "feat(web): add Container, CollectionIntroText, and EasterDates section components"
issueUrl: "https://github.com/JesusFilm/forge/issues/320"
state: "CLOSED"
closedAt: "2026-03-16T02:45:04Z"
labels: ["feat", "web"]
linkedPrs: []
---

# Issue Artifact: #320

## Background

We need to support the Easter collection page layout: a container with two slots (intro text + Easter dates card). This requires implementing the Container section (layout with slots), a text component for collection intro (title, subtitle, paragraphs with optional highlight), and an Easter dates card component with a new CMS schema.

## Expected outcome

- **Container**: Web component that renders Strapi Container section (slots with grid span and dynamic content).
- **Text (Collection intro)**: New CMS component `sections.collection-intro-text` and web component for title, subtitle, first paragraph (with highlight), second and third paragraphs.
- **Card (Easter dates)**: New CMS component `sections.easter-dates` and web component showing Western/Orthodox/Passover dates in an accordion card (Tailwind-only, no MUI).
- Easter seed script updated so the easter experience includes a Container block with the intro text and Easter dates card, so the new components can be viewed.

## Acceptance criteria

- [ ] CMS: `sections.collection-intro-text` schema added and registered in container-slot and experience blocks
- [ ] CMS: `sections.easter-dates` schema added and registered in container-slot and experience blocks
- [ ] Web: Container section fragment + component rendering slots in a grid with slot content renderer
- [ ] Web: CollectionIntroText fragment + component (Tailwind)
- [ ] Web: EasterDates fragment + component (Tailwind accordion, no MUI)
- [ ] Web: GET_WATCH_EXPERIENCE and SectionRenderer updated for Container and new types; slot content renderer for nested types
- [ ] Seed script: easter experience includes Container with two slots (collection intro text + Easter dates) using screenshot copy

## Possible solution(s)

1. Implement Container first (fragment + grid + slot content switch), then add CollectionIntroText and EasterDates schemas and components, then wire into query/renderer and seed.
2. Use native `<details>/<summary>` or button + state for EasterDates accordion to avoid adding MUI dependency.

## References

- Existing sections: `apps/cms/src/components/sections/`, `apps/web/src/components/sections/`
- Seed: `apps/cms/scripts/seed-easter.cjs`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
