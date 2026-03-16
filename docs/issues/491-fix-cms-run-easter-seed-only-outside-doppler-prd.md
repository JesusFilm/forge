---
artifactType: issue
issueNumber: 491
issueTitle: "fix(cms): run easter seed only outside doppler prd"
issueUrl: "https://github.com/JesusFilm/forge/issues/491"
state: "CLOSED"
closedAt: "2026-03-16T21:31:51Z"
labels: ["fix", "cms"]
linkedPrs: []
---

# Issue Artifact: #491

## Background

Current bootstrap guard runs Easter seed when `DOPPLER_CONFIG=prd`. We need inverse behavior so production Doppler config does not run this seed path.

## Expected outcome

Easter seed logic runs only when `DOPPLER_CONFIG` is not `prd`.

## Acceptance criteria

- [ ] Easter seed path executes only when `process.env.DOPPLER_CONFIG !== 'prd'`
- [ ] Production Doppler config (`prd`) skips Easter seed
- [ ] Non-`prd` configs (including unset) still run Easter seed

## Possible solution(s)

1. Invert the bootstrap gate from strict `=== 'prd'` to `!== 'prd'`.
2. Update skip log message to indicate seeding is skipped for `prd`.

## References

- PR #488 (merged)

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
