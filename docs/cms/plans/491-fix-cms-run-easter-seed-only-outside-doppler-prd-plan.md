---
artifactType: plan
sourceIssueNumber: 491
sourceIssueTitle: "fix(cms): run easter seed only outside doppler prd"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/491"
linkedPrs: []
scope: "cms"
---

# Plan Artifact: #491

## Objective

Easter seed logic runs only when `DOPPLER_CONFIG` is not `prd`.

## Planned approach

1. Invert the bootstrap gate from strict `=== 'prd'` to `!== 'prd'`.
2. Update skip log message to indicate seeding is skipped for `prd`.

## Validation

- [ ] Easter seed path executes only when `process.env.DOPPLER_CONFIG !== 'prd'`
- [ ] Production Doppler config (`prd`) skips Easter seed
- [ ] Non-`prd` configs (including unset) still run Easter seed

## Source links

- Issue: [#491](https://github.com/JesusFilm/forge/issues/491)
- PRs:
- None
