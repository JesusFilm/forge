---
artifactType: issue
issueNumber: 431
issueTitle: "fix(infra): compare affected-infra against last successful terraform-apply"
issueUrl: "https://github.com/JesusFilm/forge/issues/431"
state: "CLOSED"
closedAt: "2026-03-12T03:30:29Z"
labels: ["fix", "infra"]
linkedPrs: []
---

# Issue Artifact: #431

## Background

The `affected-infra` job in `terraform-apply.yml` uses `dorny/paths-filter` with its default base, which compares against the push event's `before` SHA (the previous commit on the branch). This means:

1. If a terraform apply **fails** on commit A, and commit B pushes with no infra changes, the filter sees no infra diff and **skips the apply** — leaving failed infra unapplied.
2. Batched merges may shift the comparison window and miss accumulated infra changes.

The filter should compare against the **last commit where `terraform-apply` ran successfully** on the same branch (`stage` or `main`), ensuring all unapplied infra changes are caught.

## Expected outcome

- `affected-infra` queries the GitHub API for the last successful `terraform-apply` workflow run on the current branch.
- The resulting commit SHA is passed as `base` to `dorny/paths-filter`.
- If no previous successful run exists, all stacks are treated as affected (safe default).
- `workflow_dispatch` continues to treat all stacks as affected.

## Acceptance criteria

- [ ] `affected-infra` step queries last successful `terraform-apply` run SHA on `github.ref_name`
- [ ] `dorny/paths-filter` uses that SHA as `base`
- [ ] No previous success → all stacks treated as affected
- [ ] `workflow_dispatch` behavior unchanged
- [ ] No changes to `terraform-plan.yml` (PR-based, different comparison semantics)

## Possible solution(s)

1. Add a step before `dorny/paths-filter` that calls `gh api repos/{owner}/{repo}/actions/workflows/terraform-apply.yml/runs?branch={branch}&status=success&per_page=1` to get the head SHA of the last successful run.
2. Pass that SHA as `base` input to `dorny/paths-filter@v3`.
3. Guard: if no SHA found, skip the filter and default all outputs to `'true'`.

## References

- `.github/workflows/terraform-apply.yml` — current workflow
- [dorny/paths-filter `base` parameter](https://github.com/dorny/paths-filter#base)

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
