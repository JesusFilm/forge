---
artifactType: issue
issueNumber: 405
issueTitle: "fix(infra): allow access-key programmatic access without MFA"
issueUrl: "https://github.com/JesusFilm/forge/issues/405"
state: "CLOSED"
closedAt: "2026-03-12T02:31:26Z"
labels: ["fix", "infra"]
linkedPrs: []
---

# Issue Artifact: #405

## Background

The `forge-dev-secrets` IAM group has the `forge-require-mfa` policy attached, which explicitly denies all non-MFA-setup actions when `aws:MultiFactorAuthPresent` is false. Dev-secrets users are programmatic-only (access keys) and cannot easily satisfy MFA via `sts:GetSessionToken` from CLI tooling. This blocks `pnpm fetch-secrets` entirely.

## Expected outcome

Dev-secrets users can call SSM `GetParametersByPath` and KMS `Decrypt` using long-lived access keys without MFA, since their permissions are already minimally scoped.

## Acceptance criteria

- [ ] MFA policy attachment removed from `forge-dev-secrets` group
- [ ] Other groups (admin_readonly, billing, login_profile) retain MFA enforcement
- [ ] `pnpm fetch-secrets` succeeds with dev-secrets access keys (no MFA session needed)

## Possible solution(s)

1. Remove `aws_iam_group_policy_attachment.require_mfa` from `infra/aws/iam/groups/dev_secrets/main.tf`

## References

- Policy: `infra/aws/iam/groups/require_mfa/main.tf`
- Group: `infra/aws/iam/groups/dev_secrets/main.tf`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
