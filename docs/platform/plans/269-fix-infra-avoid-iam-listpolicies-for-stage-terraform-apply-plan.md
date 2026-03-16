---
artifactType: plan
sourceIssueNumber: 269
sourceIssueTitle: "fix(infra): avoid iam:ListPolicies for stage Terraform apply"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/269"
linkedPrs: []
scope: "platform"
---

# Plan Artifact: #269

## Objective

Stage Terraform apply runs without needing `iam:ListPolicies` to resolve the apply policy ARN.

## Planned approach

1. Use a constructed policy ARN when `create_shared_github_resources` is false: `arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/forge-github-actions-terraform-apply` — no IAM lookup needed.
2. Add `iam:ListPolicies` to the shared policy and ensure prod has applied so stage role gets it (does not fix chicken-egg if role never had it).

## Validation

- [ ] Stage Terraform apply job completes (no 403 on iam:ListPolicies)
- [ ] Apply still attaches the correct shared policy to the stage role

## Source links

- Issue: [#269](https://github.com/JesusFilm/forge/issues/269)
- PRs:
- None
