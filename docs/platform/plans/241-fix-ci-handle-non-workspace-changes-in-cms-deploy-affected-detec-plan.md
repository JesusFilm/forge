---
artifactType: plan
sourceIssueNumber: 241
sourceIssueTitle: "fix(ci): handle non-workspace changes in cms deploy affected detection"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/241"
linkedPrs: []
scope: "platform"
---

# Plan Artifact: #241

## Objective

`cms-deploy` should safely handle changes outside the Turbo workspace graph and either detect CMS impact correctly or fall back to a safe deploy decision without failing the job.

## Planned approach

1. Replace Turbo-based affected detection with a simple `git diff --name-only` path check for CMS-related files.
2. Keep Turbo detection but harden parsing/error handling for empty or non-workspace diffs.

## Validation

- [ ] `cms-deploy` no longer fails in `Detect affected CMS package` for `.github`-only changes
- [ ] The workflow still deploys when CMS changes are present
- [ ] Failure modes in affected detection default to a safe outcome instead of a failed check

## Source links

- Issue: [#241](https://github.com/JesusFilm/forge/issues/241)
- PRs:
- None
