---
artifactType: issue
issueNumber: 319
issueTitle: "feat(web): add Container, Text, Card and EasterDates section components"
issueUrl: "https://github.com/JesusFilm/forge/issues/319"
state: "CLOSED"
closedAt: "2026-03-10T20:52:07Z"
labels: ["feat", "web"]
linkedPrs: []
scope: "web"
---

# Issue Artifact: #319

## Background

We need web section components for the Easter experience: a Container (side-by-side layout with slots), a Text section (including collection-intro variant with highlighted paragraph), and Card plus a new Easter dates card schema. The Easter experience should show intro copy and an Easter/Passover dates card as in the design.

## Expected outcome

- Container section component renders slots in a responsive grid; each slot can contain Text, Card, or EasterDates.
- Text section supports default (heading/subtitle/content) and collection-intro variant (title, subtitle, first paragraph with highlight, second and third paragraphs).
- Card section renders existing card schema (title, description, media, link).
- New Easter dates block (sections.easter-dates) with title, labels, locale; dates computed on frontend. Accordion-style UI without MUI.
- Easter seed script creates an experience with a Container containing Text (Easter intro) + EasterDates so the new components can be viewed.

## Acceptance criteria

- [ ] CMS: New component `sections.easter-dates` with title, westernEasterLabel, orthodoxEasterLabel, passoverLabel, locale
- [ ] CMS: Text component extended with collection-intro fields (firstParagraphBefore/Highlight/After, secondParagraph, thirdParagraph) and variant
- [ ] CMS: Easter dates added to container-slot content and experience blocks where needed
- [ ] Web: Container, Text, Card, EasterDates components with GraphQL fragments
- [ ] Web: SectionRenderer and GetWatchExperience query include new block types
- [ ] Seed script updated with Easter intro copy and dates block (2026 data from design)

## Possible solution(s)

1. Implement Container (recursive slot renderer), Text (with variant branch), Card (existing schema), and EasterDates (new schema; replace MUI Accordion with Tailwind/collapsible).
2. Seed: single Container block with two slots—one Text (collection intro), one EasterDates.

## References

- Existing sections: VideoHero, InfoBlocks, PromoBanner patterns in apps/web
- CMS section schemas: apps/cms/src/components/sections/
- seed-easter.cjs

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
