---
artifactType: issue
issueNumber: 338
issueTitle: "fix(infra): terraform apply IAM permissions for groups, users, and autoscaling"
issueUrl: "https://github.com/JesusFilm/forge/issues/338"
state: "CLOSED"
closedAt: "2026-03-10T21:59:29Z"
labels: ["fix", "infra"]
linkedPrs: []
scope: "platform"
---

# Issue Artifact: #338

## Background

The `terraform-apply` workflow for `infra/aws` fails on `main` because the `forge-github-actions-terraform-apply-prod` IAM role lacks permissions introduced by recent changes (IAM module for groups/users and ECS autoscaling).

Failing run: https://github.com/JesusFilm/forge/actions/runs/22925832670/job/66535976097

Two categories of errors:

1. `iam:CreateGroup` — **explicitly denied** by `DenyIamUserAndGroupMutation` in the apply policy
2. `application-autoscaling:RegisterScalableTarget` — **not allowed** (missing from the service list)

## Expected outcome

`terraform apply` succeeds for `infra/aws` on both `stage` and `prod` branches, creating IAM groups, users, and ECS autoscaling resources.

## Acceptance criteria

- [ ] `application-autoscaling:*` added to the `TerraformAwsServiceManagement` allow statement
- [ ] IAM group CRUD allowed, scoped to `arn:aws:iam::*:group/forge-*`
- [ ] IAM user lifecycle allowed, scoped to `arn:aws:iam::*:user/*`
- [ ] Credential-mutation deny guardrail retained (access keys, login profiles, inline user policies)
- [ ] `terraform-apply` CI passes

## Possible solution(s)

1. Add `application-autoscaling:*` to the existing service-management allow
2. Split the old `DenyIamUserAndGroupMutation` into scoped allows for groups/users plus a narrower deny for credential mutations

## References

- Failed run: https://github.com/JesusFilm/forge/actions/runs/22925832670/job/66535976097
- PR that introduced IAM module + autoscaling: #302

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
