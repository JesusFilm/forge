---
artifactType: issue
issueNumber: 239
issueTitle: "fix(ci): add action run link to terraform plan comment"
issueUrl: "https://github.com/JesusFilm/forge/issues/239"
state: "CLOSED"
closedAt: "2026-03-06T05:01:40Z"
labels: []
linkedPrs: []
---

# Issue Artifact: #239

## Background

The Terraform apply commit comment includes a GitHub Actions run link, but the Terraform plan PR comment does not. That makes it slower to jump from the plan summary to the exact workflow run.

## Expected outcome

Terraform plan comments include the workflow run link in the same style as the apply comment.

## Acceptance criteria

- [ ] Terraform plan PR comments include a `Run:` link to the GitHub Actions run.
- [ ] Existing plan comment behavior for status, change summary, time table, and log output remains unchanged.

## Possible solution(s)

1. Build the run URL from the GitHub Actions context in the plan comment action, matching the apply comment implementation.
2. Append the run URL to the generated plan comment body before the log block.

## References

- `.github/actions/terraform-plan-comment/comment.js`
- `.github/actions/terraform-apply-comment/comment.js`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
