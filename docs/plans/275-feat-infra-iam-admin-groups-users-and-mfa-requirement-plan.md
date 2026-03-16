---
artifactType: plan
sourceIssueNumber: 275
sourceIssueTitle: "feat(infra): IAM admin groups, users, and MFA requirement"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/275"
linkedPrs: []
---

# Plan Artifact: #275

## Objective

- Single `module "iam"` at root; `iam/` contains groups and users.
- Groups: `forge-admin-readonly` (ReadOnlyAccess), `forge-billing` (Billing console), `forge-iam-login-profile` (set console password for existing users), `forge-require-mfa` (deny all unless MFA present, allow MFA setup).
- Users defined under `iam/users/<name>/`; group membership via data lookups (no variable passing).
- First sign-in: user can only set up MFA and change password; after MFA, full group permissions apply.

## Planned approach

1. One `iam` module; `iam/main.tf` calls `groups` and `users` with `depends_on`.
2. Groups as submodules; require_mfa as managed policy attached to each capability group.
3. User modules use `data "aws_iam_group"` for group names (e.g. `forge-admin-readonly`).

## Validation

- [ ] `infra/aws/main.tf` calls `module "iam"` only.
- [ ] `iam/groups/` has `admin_readonly`, `billing`, `login_profile`, `require_mfa`; `groups/main.tf` ties them together.
- [ ] `iam/users/main.tf` loads per-user modules (e.g. tataihono).
- [ ] User tataihono in `forge-admin-readonly`, `forge-billing`, `forge-iam-login-profile`; all three groups have `forge-require-mfa` attached.
- [ ] Terraform plan/apply succeeds; no unnecessary outputs.

## Source links

- Issue: [#275](https://github.com/JesusFilm/forge/issues/275)
- PRs:
- None
