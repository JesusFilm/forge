---
artifactType: plan
sourceId: 491
sourceTitle: "fix(cms): run easter seed only outside doppler prd"
linkedPrs: []
scope: "cms"
---

# Plan Artifact: "fix(cms): run easter seed only outside doppler prd"

## Objective

Easter seed logic runs only when `DOPPLER_CONFIG` is not `prd`.

## Planned approach

1. Invert the bootstrap gate from strict `=== 'prd'` to `!== 'prd'`.
2. Update skip log message to indicate seeding is skipped for `prd`.

## Validation

- [ ] Easter seed path executes only when `process.env.DOPPLER_CONFIG !== 'prd'`
- [ ] Production Doppler config (`prd`) skips Easter seed
- [ ] Non-`prd` configs (including unset) still run Easter seed

## References

- PR #488 (merged)

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
