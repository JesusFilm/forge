---
artifactType: plan
sourceIssueNumber: 156
sourceIssueTitle: "feat(web): add RelatedQuestions component"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/156"
linkedPrs:
  [
    { "number": 494, "url": "https://github.com/JesusFilm/forge/pull/494" },
    { "number": 492, "url": "https://github.com/JesusFilm/forge/pull/492" },
    { "number": 490, "url": "https://github.com/JesusFilm/forge/pull/490" },
    { "number": 488, "url": "https://github.com/JesusFilm/forge/pull/488" },
    { "number": 486, "url": "https://github.com/JesusFilm/forge/pull/486" },
    { "number": 485, "url": "https://github.com/JesusFilm/forge/pull/485" },
    { "number": 484, "url": "https://github.com/JesusFilm/forge/pull/484" },
    { "number": 482, "url": "https://github.com/JesusFilm/forge/pull/482" },
    { "number": 480, "url": "https://github.com/JesusFilm/forge/pull/480" },
    { "number": 478, "url": "https://github.com/JesusFilm/forge/pull/478" },
    { "number": 477, "url": "https://github.com/JesusFilm/forge/pull/477" },
    { "number": 475, "url": "https://github.com/JesusFilm/forge/pull/475" },
    { "number": 473, "url": "https://github.com/JesusFilm/forge/pull/473" },
    { "number": 472, "url": "https://github.com/JesusFilm/forge/pull/472" },
    { "number": 470, "url": "https://github.com/JesusFilm/forge/pull/470" },
    { "number": 468, "url": "https://github.com/JesusFilm/forge/pull/468" },
    { "number": 466, "url": "https://github.com/JesusFilm/forge/pull/466" },
    { "number": 463, "url": "https://github.com/JesusFilm/forge/pull/463" },
    { "number": 462, "url": "https://github.com/JesusFilm/forge/pull/462" },
    { "number": 461, "url": "https://github.com/JesusFilm/forge/pull/461" },
  ]
---

# Plan Artifact: #156

## Objective

- A RelatedQuestions component in `apps/web` that consumes RelatedQuestions block data and renders heading + repeatable Q&A items (accordion or list, per design).

## Planned approach

1. Add `apps/web/src/components/sections/RelatedQuestions.tsx`; render as accordion (expand/collapse) or static list based on design.
2. Reuse shared accordion or disclosure component if available; keep content driven by CMS data.

## Validation

- [ ] RelatedQuestions component implemented and wired to API/GraphQL shape.
- [ ] Renders heading and repeatable question/answer items; accessible (e.g. expandable sections with keyboard support).
- [ ] Styled per design system; integrated into dynamic zone or section rendering.

## Source links

- Issue: [#156](https://github.com/JesusFilm/forge/issues/156)
- PRs:
- [#494](https://github.com/JesusFilm/forge/pull/494)
- [#492](https://github.com/JesusFilm/forge/pull/492)
- [#490](https://github.com/JesusFilm/forge/pull/490)
- [#488](https://github.com/JesusFilm/forge/pull/488)
- [#486](https://github.com/JesusFilm/forge/pull/486)
- [#485](https://github.com/JesusFilm/forge/pull/485)
- [#484](https://github.com/JesusFilm/forge/pull/484)
- [#482](https://github.com/JesusFilm/forge/pull/482)
- [#480](https://github.com/JesusFilm/forge/pull/480)
- [#478](https://github.com/JesusFilm/forge/pull/478)
- [#477](https://github.com/JesusFilm/forge/pull/477)
- [#475](https://github.com/JesusFilm/forge/pull/475)
- [#473](https://github.com/JesusFilm/forge/pull/473)
- [#472](https://github.com/JesusFilm/forge/pull/472)
- [#470](https://github.com/JesusFilm/forge/pull/470)
- [#468](https://github.com/JesusFilm/forge/pull/468)
- [#466](https://github.com/JesusFilm/forge/pull/466)
- [#463](https://github.com/JesusFilm/forge/pull/463)
- [#462](https://github.com/JesusFilm/forge/pull/462)
- [#461](https://github.com/JesusFilm/forge/pull/461)
