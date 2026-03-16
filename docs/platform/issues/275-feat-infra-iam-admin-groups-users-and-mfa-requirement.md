---
artifactType: issue
issueNumber: 275
issueTitle: "feat(infra): IAM admin groups, users, and MFA requirement"
issueUrl: "https://github.com/JesusFilm/forge/issues/275"
state: "CLOSED"
closedAt: "2026-03-07T11:22:41Z"
labels: ["feat", "infra"]
linkedPrs: []
scope: "platform"
---

# Issue Artifact: #275

## Background

We need a personal/admin IAM setup: read-only console access, Billing and Cost Management (payment methods, contacts), and the ability to set console passwords for other admin users. Permissions should be group-based. Users must be required to set up MFA on first sign-in.

## Expected outcome

- Single `module "iam"` at root; `iam/` contains groups and users.
- Groups: `forge-admin-readonly` (ReadOnlyAccess), `forge-billing` (Billing console), `forge-iam-login-profile` (set console password for existing users), `forge-require-mfa` (deny all unless MFA present, allow MFA setup).
- Users defined under `iam/users/<name>/`; group membership via data lookups (no variable passing).
- First sign-in: user can only set up MFA and change password; after MFA, full group permissions apply.

## Acceptance criteria

- [ ] `infra/aws/main.tf` calls `module "iam"` only.
- [ ] `iam/groups/` has `admin_readonly`, `billing`, `login_profile`, `require_mfa`; `groups/main.tf` ties them together.
- [ ] `iam/users/main.tf` loads per-user modules (e.g. tataihono).
- [ ] User tataihono in `forge-admin-readonly`, `forge-billing`, `forge-iam-login-profile`; all three groups have `forge-require-mfa` attached.
- [ ] Terraform plan/apply succeeds; no unnecessary outputs.

## Possible solution(s)

1. One `iam` module; `iam/main.tf` calls `groups` and `users` with `depends_on`.
2. Groups as submodules; require_mfa as managed policy attached to each capability group.
3. User modules use `data "aws_iam_group"` for group names (e.g. `forge-admin-readonly`).

## References

- infra/aws/iam/
- AWS IAM MFA condition: aws:MultiFactorAuthPresent
- Billing console: root must enable IAM access at https://console.aws.amazon.com/billing/home#/account

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
