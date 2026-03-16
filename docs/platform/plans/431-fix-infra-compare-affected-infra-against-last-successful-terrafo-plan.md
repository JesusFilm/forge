---
artifactType: plan
sourceIssueNumber: 431
sourceIssueTitle: "fix(infra): compare affected-infra against last successful terraform-apply"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/431"
linkedPrs: []
scope: "platform"
---

# Plan Artifact: #431

## Objective

- `affected-infra` queries the GitHub API for the last successful `terraform-apply` workflow run on the current branch.
- The resulting commit SHA is passed as `base` to `dorny/paths-filter`.
- If no previous successful run exists, all stacks are treated as affected (safe default).
- `workflow_dispatch` continues to treat all stacks as affected.

## Planned approach

1. Add a step before `dorny/paths-filter` that calls `gh api repos/{owner}/{repo}/actions/workflows/terraform-apply.yml/runs?branch={branch}&status=success&per_page=1` to get the head SHA of the last successful run.
2. Pass that SHA as `base` input to `dorny/paths-filter@v3`.
3. Guard: if no SHA found, skip the filter and default all outputs to `'true'`.

## Validation

- [ ] `affected-infra` step queries last successful `terraform-apply` run SHA on `github.ref_name`
- [ ] `dorny/paths-filter` uses that SHA as `base`
- [ ] No previous success → all stacks treated as affected
- [ ] `workflow_dispatch` behavior unchanged
- [ ] No changes to `terraform-plan.yml` (PR-based, different comparison semantics)

## Source links

- Issue: [#431](https://github.com/JesusFilm/forge/issues/431)
- PRs:
- None
