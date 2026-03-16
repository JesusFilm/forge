---
artifactType: issue
issueNumber: 279
issueTitle: "fix(ci): capture format/validate failure output in Terraform plan/apply comments"
issueUrl: "https://github.com/JesusFilm/forge/issues/279"
state: "CLOSED"
closedAt: "2026-03-07T11:24:02Z"
labels: []
linkedPrs: []
---

# Issue Artifact: #279

## Background

When Terraform plan or apply jobs fail on format check or validate (or init), the PR/commit comment still runs (`if: always()`) but only has access to the plan/apply output file. That file was never written, so the comment shows a generic "Unable to read ... ENOENT" and is not useful.

## Expected outcome

The comment should show the actual failure output (e.g. `terraform fmt -check` or `terraform validate` output) when the main plan/apply log is missing, so reviewers see why the job failed.

## Acceptance criteria

- [ ] Plan jobs (AWS, Vercel, GitHub): format check, init, validate output is captured to a job log; comment uses this when plan output file is missing
- [ ] Apply jobs: init (and any pre-apply) output captured; apply comment uses it when apply output is missing
- [ ] Comment text clearly indicates when showing pre-step failure (e.g. "Pre-plan step failed") vs plan/apply result

## Possible solution(s)

1. Add a job-scoped log file (e.g. `job-log.txt`). Run format check, init, validate appending to it (e.g. `terraform fmt -check -recursive 2>&1 | tee -a job-log.txt`). Pass path as optional `fallback_log` to the comment action. In the action, when `output_file` is missing or empty, read `fallback_log` and display it with a "Pre-plan step failed"-style status.
2. Same pattern for apply: capture init output to a file, pass as fallback so apply comment can show init failure.

## References

- `.github/workflows/terraform-plan.yml`, `terraform-apply.yml`
- `.github/actions/terraform-plan-comment/`, `terraform-apply-comment/`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
