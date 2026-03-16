---
artifactType: plan
sourceIssueNumber: 402
sourceIssueTitle: "fix(infra): MFA deny policy blocks password change on first login"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/402"
linkedPrs: []
---

# Plan Artifact: #402

## Objective

Users can change their password and set up MFA on first console login without hitting "You may not be authorized to perform this action" errors.

## Planned approach

1. Change the Deny statement from `actions = ["*"]` to `not_actions = [list of self-service actions]` so the deny does not apply to MFA setup or password change.

## Validation

- [x] Deny statement uses `not_actions` (IAM `NotAction`) instead of `actions = ["*"]` to exclude MFA setup and password self-service actions from the deny
- [x] First-login password change and MFA enrollment work for dev-secrets users

## Source links

- Issue: [#402](https://github.com/JesusFilm/forge/issues/402)
- PRs:
- None
