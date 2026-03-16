---
artifactType: plan
sourceIssueNumber: 239
sourceIssueTitle: "fix(ci): add action run link to terraform plan comment"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/239"
linkedPrs: []
---

# Plan Artifact: #239

## Objective

Terraform plan comments include the workflow run link in the same style as the apply comment.

## Planned approach

1. Build the run URL from the GitHub Actions context in the plan comment action, matching the apply comment implementation.
2. Append the run URL to the generated plan comment body before the log block.

## Validation

- [ ] Terraform plan PR comments include a `Run:` link to the GitHub Actions run.
- [ ] Existing plan comment behavior for status, change summary, time table, and log output remains unchanged.

## Source links

- Issue: [#239](https://github.com/JesusFilm/forge/issues/239)
- PRs:
- None
