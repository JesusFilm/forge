---
artifactType: issue
issueNumber: 269
issueTitle: "fix(infra): avoid iam:ListPolicies for stage Terraform apply"
issueUrl: "https://github.com/JesusFilm/forge/issues/269"
state: "CLOSED"
closedAt: "2026-03-06T11:48:45Z"
labels: ["fix", "infra"]
linkedPrs: []
scope: "platform"
---

# Issue Artifact: #269

## Background

Stage Terraform apply fails with:
`User: arn:aws:sts::031374266475:assumed-role/forge-github-actions-terraform-apply-stage/GitHubActions is not authorized to perform: iam:ListPolicies`

For stage, the module uses `data "aws_iam_policy" "github_actions_terraform_apply"` to look up the shared policy by name; that data source requires `iam:ListPolicies`. The role may have an older policy or the permission is not available in this context.

## Expected outcome

Stage Terraform apply runs without needing `iam:ListPolicies` to resolve the apply policy ARN.

## Acceptance criteria

- [ ] Stage Terraform apply job completes (no 403 on iam:ListPolicies)
- [ ] Apply still attaches the correct shared policy to the stage role

## Possible solution(s)

1. Use a constructed policy ARN when `create_shared_github_resources` is false: `arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/forge-github-actions-terraform-apply` — no IAM lookup needed.
2. Add `iam:ListPolicies` to the shared policy and ensure prod has applied so stage role gets it (does not fix chicken-egg if role never had it).

## References

- Error seen on terraform-apply for fix(infra): add ECS container healthCheck for CMS task (#268) on stage

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
