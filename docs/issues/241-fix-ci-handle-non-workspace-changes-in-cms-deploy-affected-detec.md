---
artifactType: issue
issueNumber: 241
issueTitle: "fix(ci): handle non-workspace changes in cms deploy affected detection"
issueUrl: "https://github.com/JesusFilm/forge/issues/241"
state: "CLOSED"
closedAt: "2026-03-06T05:27:19Z"
labels: []
linkedPrs: []
---

# Issue Artifact: #241

## Background

Pushes that only change GitHub workflow/action files can still trigger `cms-deploy`, but the `Detect affected CMS package` step currently shells out to Turbo affected detection in a way that can fail and produce a red check.

## Expected outcome

`cms-deploy` should safely handle changes outside the Turbo workspace graph and either detect CMS impact correctly or fall back to a safe deploy decision without failing the job.

## Acceptance criteria

- [ ] `cms-deploy` no longer fails in `Detect affected CMS package` for `.github`-only changes
- [ ] The workflow still deploys when CMS changes are present
- [ ] Failure modes in affected detection default to a safe outcome instead of a failed check

## Possible solution(s)

1. Replace Turbo-based affected detection with a simple `git diff --name-only` path check for CMS-related files.
2. Keep Turbo detection but harden parsing/error handling for empty or non-workspace diffs.

## References

- https://github.com/JesusFilm/forge/actions/runs/22749853514/job/65981903605
- https://github.com/JesusFilm/forge/pull/240

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
