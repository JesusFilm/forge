---
artifactType: plan
sourceIssueNumber: 338
sourceIssueTitle: "fix(infra): terraform apply IAM permissions for groups, users, and autoscaling"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/338"
linkedPrs: []
scope: "platform"
---

# Plan Artifact: #338

## Objective

`terraform apply` succeeds for `infra/aws` on both `stage` and `prod` branches, creating IAM groups, users, and ECS autoscaling resources.

## Planned approach

1. Add `application-autoscaling:*` to the existing service-management allow
2. Split the old `DenyIamUserAndGroupMutation` into scoped allows for groups/users plus a narrower deny for credential mutations

## Validation

- [ ] `application-autoscaling:*` added to the `TerraformAwsServiceManagement` allow statement
- [ ] IAM group CRUD allowed, scoped to `arn:aws:iam::*:group/forge-*`
- [ ] IAM user lifecycle allowed, scoped to `arn:aws:iam::*:user/*`
- [ ] Credential-mutation deny guardrail retained (access keys, login profiles, inline user policies)
- [ ] `terraform-apply` CI passes

## Source links

- Issue: [#338](https://github.com/JesusFilm/forge/issues/338)
- PRs:
- None
