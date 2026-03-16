---
artifactType: issue
issueNumber: 407
issueTitle: "fix(infra): add SES permissions to terraform apply IAM role"
issueUrl: "https://github.com/JesusFilm/forge/issues/407"
state: "CLOSED"
closedAt: "2026-03-12T02:00:04Z"
labels: ["fix", "infra"]
linkedPrs: []
scope: "platform"
---

# Issue Artifact: #407

## Background

PR #400 added SES domain identity and DKIM resources to the `platform` module, but the `forge-github-actions-terraform-apply-prod` IAM role's policy (`TerraformAwsServiceManagement`) doesn't include `ses:*`. Terraform apply fails with `AccessDenied` on `ses:VerifyDomainIdentity`.

## Expected outcome

Terraform apply succeeds for SES resources without IAM permission errors.

## Acceptance criteria

- [ ] `ses:*` added to `TerraformAwsServiceManagement` actions in `infra/aws/github/terraform.tf`
- [ ] Terraform plan shows no unexpected changes beyond the policy update

## Possible solution(s)

Not provided in source issue.

## References

- #396 / #400 — SES email provider feature
- Error: `ses:VerifyDomainIdentity` denied for `forge-github-actions-terraform-apply-prod`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
