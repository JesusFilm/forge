---
artifactType: issue
issueNumber: 487
issueTitle: "fix(cms): gate easter seed to doppler prd"
issueUrl: "https://github.com/JesusFilm/forge/issues/487"
state: "CLOSED"
closedAt: "2026-03-16T21:22:02Z"
labels: ["fix", "cms"]
linkedPrs: []
scope: "cms"
---

# Issue Artifact: #487

## Background

Stage appears to run with `NODE_ENV=prod`, so the current Easter seeding condition can execute outside true production and seed unintended environments.

## Expected outcome

Easter seed logic runs only when `DOPPLER_CONFIG=prd`, regardless of `NODE_ENV`.

## Acceptance criteria

- [ ] Easter seed path checks `DOPPLER_CONFIG` and only executes when value is exactly `prd`
- [ ] Stage (non-`prd` Doppler config) no longer triggers Easter seed
- [ ] Existing production behavior remains intact when `DOPPLER_CONFIG=prd`

## Possible solution(s)

1. Replace or tighten current environment guard in seed entrypoint to require `process.env.DOPPLER_CONFIG === 'prd'`.
2. Add a small log message showing seed skipped due to non-`prd` config for traceability.

## References

- Stage environment config discussion

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
