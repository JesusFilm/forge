---
artifactType: plan
sourceIssueNumber: 145
sourceIssueTitle: "feat(cms): add schema for Section component (background, blur hash, children)"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/145"
linkedPrs:
  [
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
    { "number": 457, "url": "https://github.com/JesusFilm/forge/pull/457" },
  ]
---

# Plan Artifact: #145

## Objective

- A Section component exists with attributes: background color (or theme), blur hash (for image placeholder), and repeatable/dynamic children (items).

## Planned approach

1. Add `components/sections/section.json` with `backgroundColor`, `blurHash` (string), `items` (component, repeatable).
2. Optional: `backgroundImage` relation plus `blurHash` for placeholder while loading.

## Validation

- [ ] Section component JSON schema added in CMS.
- [ ] Attributes include background color (or enum) and blur hash (string).
- [ ] Component accepts `items` or `children` as repeatable components.
- [ ] Component registered and available; GraphQL regenerated if contracts change.

## Source links

- Issue: [#145](https://github.com/JesusFilm/forge/issues/145)
- PRs:
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
- [#457](https://github.com/JesusFilm/forge/pull/457)
