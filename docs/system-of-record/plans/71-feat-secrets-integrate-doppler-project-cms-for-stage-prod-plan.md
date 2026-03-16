---
artifactType: plan
sourceIssueNumber: 71
sourceIssueTitle: "feat(secrets): integrate doppler project cms for stage/prod"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/71"
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

# Plan Artifact: #71

## Objective

Doppler project `cms` with `stage` and `prod` configurations is integrated into deployment workflows and documented, with clear key mapping to CMS runtime config.

## Planned approach

1. Use Doppler service tokens scoped per environment.
2. Inject env vars at workflow runtime for Terraform/app deploy jobs.
3. Keep a generated non-secret `.env.example` contract in repo for developer clarity.

## Validation

- [ ] Doppler project `cms` exists with configs: `stage`, `prod` (and optional `dev` if needed).
- [ ] Required CMS keys are defined with owner notes and rotation expectations.
- [ ] GitHub Actions uses Doppler token(s) to inject runtime values.
- [ ] No sensitive CMS secrets are committed to repo or long-lived static GH secrets.
- [ ] Secret mapping document links key -> consuming config path.

## Source links

- Issue: [#71](https://github.com/JesusFilm/forge/issues/71)
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
