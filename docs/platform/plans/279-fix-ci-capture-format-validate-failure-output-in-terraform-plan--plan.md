---
artifactType: plan
sourceIssueNumber: 279
sourceIssueTitle: "fix(ci): capture format/validate failure output in Terraform plan/apply comments"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/279"
linkedPrs: []
scope: "platform"
---

# Plan Artifact: #279

## Objective

The comment should show the actual failure output (e.g. `terraform fmt -check` or `terraform validate` output) when the main plan/apply log is missing, so reviewers see why the job failed.

## Planned approach

1. Add a job-scoped log file (e.g. `job-log.txt`). Run format check, init, validate appending to it (e.g. `terraform fmt -check -recursive 2>&1 | tee -a job-log.txt`). Pass path as optional `fallback_log` to the comment action. In the action, when `output_file` is missing or empty, read `fallback_log` and display it with a "Pre-plan step failed"-style status.
2. Same pattern for apply: capture init output to a file, pass as fallback so apply comment can show init failure.

## Validation

- [ ] Plan jobs (AWS, Vercel, GitHub): format check, init, validate output is captured to a job log; comment uses this when plan output file is missing
- [ ] Apply jobs: init (and any pre-apply) output captured; apply comment uses it when apply output is missing
- [ ] Comment text clearly indicates when showing pre-step failure (e.g. "Pre-plan step failed") vs plan/apply result

## Source links

- Issue: [#279](https://github.com/JesusFilm/forge/issues/279)
- PRs:
- None
