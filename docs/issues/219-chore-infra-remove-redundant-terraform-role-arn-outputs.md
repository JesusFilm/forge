---
artifactType: issue
issueNumber: 219
issueTitle: "chore(infra): remove redundant terraform role arn outputs"
issueUrl: "https://github.com/JesusFilm/forge/issues/219"
state: "CLOSED"
closedAt: "2026-03-08T22:01:05Z"
labels: ["chore", "infra"]
linkedPrs: []
---

# Issue Artifact: #219

## Background

Terraform still exposes `github_actions_terraform_vercel_apply_role_arn`, `github_actions_terraform_vercel_plan_role_arn`, `github_actions_terraform_github_apply_role_arn`, and `github_actions_terraform_github_plan_role_arn` as outputs even though these values are now passed around through SSM.

## Expected outcome

Those redundant outputs are removed anywhere they are still declared or surfaced in Terraform, so infra state reflects the current SSM-based flow.

## Acceptance criteria

- [ ] Terraform no longer defines those four role ARN outputs.
- [ ] Any references/docs tied to those outputs are updated if needed.
- [ ] Validation is run for touched Terraform files.

## Possible solution(s)

1. Remove the obsolete output blocks from the relevant Terraform modules/stacks.
2. Update any nearby references or comments that still imply consumers should read the values from Terraform outputs.

## References

- User request in Cursor chat on 2026-03-06

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
