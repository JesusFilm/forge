---
artifactType: plan
sourceIssueNumber: 75
sourceIssueTitle: "feat(ci): automate web deploy pipeline with turbo affected gating"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/75"
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

# Plan Artifact: #75

## Objective

A CI pipeline where web deploy jobs execute only when relevant app/dependency changes occur, with deterministic mapping for PR, `stage`, and `main` events.

## Planned approach

1. Add dedicated workflow for web deploy events with shared affected detector.
2. Reuse affected logic pattern from existing CI and normalize output flags.
3. Add guard jobs that short-circuit deploy with clear skip reason.

## Validation

- [ ] PR events trigger preview deploy when web is affected.
- [ ] `stage` pushes deploy to stage target only when web is affected.
- [ ] `main` pushes deploy to production only when web is affected.
- [ ] Turbo affected gating logic is explicit and testable in workflow logs.
- [ ] Failure modes and retry behavior are documented.

## Source links

- Issue: [#75](https://github.com/JesusFilm/forge/issues/75)
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
