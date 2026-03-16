---
artifactType: plan
sourceIssueNumber: 405
sourceIssueTitle: "fix(infra): allow access-key programmatic access without MFA"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/405"
linkedPrs: []
scope: "platform"
---

# Plan Artifact: #405

## Objective

Dev-secrets users can call SSM `GetParametersByPath` and KMS `Decrypt` using long-lived access keys without MFA, since their permissions are already minimally scoped.

## Planned approach

1. Remove `aws_iam_group_policy_attachment.require_mfa` from `infra/aws/iam/groups/dev_secrets/main.tf`

## Validation

- [ ] MFA policy attachment removed from `forge-dev-secrets` group
- [ ] Other groups (admin_readonly, billing, login_profile) retain MFA enforcement
- [ ] `pnpm fetch-secrets` succeeds with dev-secrets access keys (no MFA session needed)

## Source links

- Issue: [#405](https://github.com/JesusFilm/forge/issues/405)
- PRs:
- None
