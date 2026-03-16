---
artifactType: plan
sourceIssueNumber: 407
sourceIssueTitle: "fix(infra): add SES permissions to terraform apply IAM role"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/407"
linkedPrs: []
---

# Plan Artifact: #407

## Objective

Terraform apply succeeds for SES resources without IAM permission errors.

## Planned approach

Not provided in source issue.

## Validation

- [ ] `ses:*` added to `TerraformAwsServiceManagement` actions in `infra/aws/github/terraform.tf`
- [ ] Terraform plan shows no unexpected changes beyond the policy update

## Source links

- Issue: [#407](https://github.com/JesusFilm/forge/issues/407)
- PRs:
- None
