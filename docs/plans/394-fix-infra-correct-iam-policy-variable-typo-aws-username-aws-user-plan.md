---
artifactType: plan
sourceIssueNumber: 394
sourceIssueTitle: "fix(infra): correct IAM policy variable typo &{aws:username} → ${aws:username}"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/394"
linkedPrs: []
---

# Plan Artifact: #394

## Objective

IAM policies use the correct `${aws:username}` variable (escaped as `$${aws:username}` in Terraform HCL) so that resource ARNs resolve to the calling user's own resources.

## Planned approach

1. Replace `&{aws:username}` with `$${aws:username}` in both files

## Validation

- [ ] `infra/aws/iam/groups/dev_secrets/main.tf` uses `$${aws:username}` in ManageOwnAccessKeys resource ARN
- [ ] `infra/aws/iam/groups/require_mfa/main.tf` uses `$${aws:username}` in AllowMFASetupAndSelfService resource ARNs
- [ ] Terraform plan shows policy document changes only (no resource recreation)

## Source links

- Issue: [#394](https://github.com/JesusFilm/forge/issues/394)
- PRs:
- None
