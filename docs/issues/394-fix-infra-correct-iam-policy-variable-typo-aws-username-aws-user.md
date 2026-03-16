---
artifactType: issue
issueNumber: 394
issueTitle: "fix(infra): correct IAM policy variable typo &{aws:username} → ${aws:username}"
issueUrl: "https://github.com/JesusFilm/forge/issues/394"
state: "CLOSED"
closedAt: "2026-03-11T22:59:59Z"
labels: ["fix", "infra"]
linkedPrs: []
---

# Issue Artifact: #394

## Background

The `ManageOwnAccessKeys` statement in the dev_secrets group policy and the `AllowMFASetupAndSelfService` statement in the require_mfa policy use `&{aws:username}` instead of `${aws:username}`. This means the IAM policy variable is never resolved, so "own user only" scoping is broken — users cannot manage their own access keys or set up MFA.

## Expected outcome

IAM policies use the correct `${aws:username}` variable (escaped as `$${aws:username}` in Terraform HCL) so that resource ARNs resolve to the calling user's own resources.

## Acceptance criteria

- [ ] `infra/aws/iam/groups/dev_secrets/main.tf` uses `$${aws:username}` in ManageOwnAccessKeys resource ARN
- [ ] `infra/aws/iam/groups/require_mfa/main.tf` uses `$${aws:username}` in AllowMFASetupAndSelfService resource ARNs
- [ ] Terraform plan shows policy document changes only (no resource recreation)

## Possible solution(s)

1. Replace `&{aws:username}` with `$${aws:username}` in both files

## References

- `infra/aws/iam/groups/dev_secrets/main.tf:58`
- `infra/aws/iam/groups/require_mfa/main.tf:36-37`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
