---
artifactType: plan
sourceIssueNumber: 487
sourceIssueTitle: "fix(cms): gate easter seed to doppler prd"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/487"
linkedPrs: []
---

# Plan Artifact: #487

## Objective

Easter seed logic runs only when `DOPPLER_CONFIG=prd`, regardless of `NODE_ENV`.

## Planned approach

1. Replace or tighten current environment guard in seed entrypoint to require `process.env.DOPPLER_CONFIG === 'prd'`.
2. Add a small log message showing seed skipped due to non-`prd` config for traceability.

## Validation

- [ ] Easter seed path checks `DOPPLER_CONFIG` and only executes when value is exactly `prd`
- [ ] Stage (non-`prd` Doppler config) no longer triggers Easter seed
- [ ] Existing production behavior remains intact when `DOPPLER_CONFIG=prd`

## Source links

- Issue: [#487](https://github.com/JesusFilm/forge/issues/487)
- PRs:
- None
