---
artifactType: plan
sourceIssueNumber: 182
sourceIssueTitle: "fix(terraform): allow CreateServiceLinkedRole for RDS and ELB"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/182"
linkedPrs: []
---

# Plan Artifact: #182

## Objective

Apply role can create AWS service-linked roles (e.g. for RDS, Elastic Load Balancing) so terraform apply succeeds.

## Planned approach

1. Add a statement to `github_actions_terraform_apply` policy: allow `iam:CreateServiceLinkedRole` with resource `arn:aws:iam::*:role/aws-service-role/*` (scoped to SLRs only).

## Validation

- [ ] Apply role policy allows `iam:CreateServiceLinkedRole` on service-linked role ARNs
- [ ] Terraform apply (aws/prod) can create RDS and ALB when SLRs are missing
- [ ] No new permissions for IAM users/groups or non-forge resources

## Source links

- Issue: [#182](https://github.com/JesusFilm/forge/issues/182)
- PRs:
- None
