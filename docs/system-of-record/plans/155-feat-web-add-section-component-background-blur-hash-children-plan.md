---
artifactType: plan
sourceIssueNumber: 155
sourceIssueTitle: "feat(web): add Section component (background, blur hash, children)"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/155"
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

# Plan Artifact: #155

## Objective

- A Section component in `apps/web` that consumes Section block data (backgroundColor, blurHash, items/children) and renders a styled section with correct background and child content.

## Planned approach

1. Add `apps/web/src/components/sections/Section.tsx`; apply `backgroundColor`/theme and optional blur-hash image placeholder; map `items` to section children components.
2. Integrate with existing layout/section wrapper if one exists; keep styling tokens consistent.

## Validation

- [ ] Section component implemented and wired to API/GraphQL shape.
- [ ] Applies background color (or theme) from schema.
- [ ] Uses blur hash for placeholder/loading where applicable.
- [ ] Renders children/items (e.g. via dynamic component map); integrated into page rendering.

## Source links

- Issue: [#155](https://github.com/JesusFilm/forge/issues/155)
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
