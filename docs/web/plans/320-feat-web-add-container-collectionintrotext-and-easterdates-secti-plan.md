---
artifactType: plan
sourceIssueNumber: 320
sourceIssueTitle: "feat(web): add Container, CollectionIntroText, and EasterDates section components"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/320"
linkedPrs: []
scope: "web"
---

# Plan Artifact: #320

## Objective

- **Container**: Web component that renders Strapi Container section (slots with grid span and dynamic content).
- **Text (Collection intro)**: New CMS component `sections.collection-intro-text` and web component for title, subtitle, first paragraph (with highlight), second and third paragraphs.
- **Card (Easter dates)**: New CMS component `sections.easter-dates` and web component showing Western/Orthodox/Passover dates in an accordion card (Tailwind-only, no MUI).
- Easter seed script updated so the easter experience includes a Container block with the intro text and Easter dates card, so the new components can be viewed.

## Planned approach

1. Implement Container first (fragment + grid + slot content switch), then add CollectionIntroText and EasterDates schemas and components, then wire into query/renderer and seed.
2. Use native `<details>/<summary>` or button + state for EasterDates accordion to avoid adding MUI dependency.

## Validation

- [ ] CMS: `sections.collection-intro-text` schema added and registered in container-slot and experience blocks
- [ ] CMS: `sections.easter-dates` schema added and registered in container-slot and experience blocks
- [ ] Web: Container section fragment + component rendering slots in a grid with slot content renderer
- [ ] Web: CollectionIntroText fragment + component (Tailwind)
- [ ] Web: EasterDates fragment + component (Tailwind accordion, no MUI)
- [ ] Web: GET_WATCH_EXPERIENCE and SectionRenderer updated for Container and new types; slot content renderer for nested types
- [ ] Seed script: easter experience includes Container with two slots (collection intro text + Easter dates) using screenshot copy

## Source links

- Issue: [#320](https://github.com/JesusFilm/forge/issues/320)
- PRs:
- None
