---
artifactType: issue
issueNumber: 402
issueTitle: "fix(infra): MFA deny policy blocks password change on first login"
issueUrl: "https://github.com/JesusFilm/forge/issues/402"
state: "CLOSED"
closedAt: "2026-03-12T01:06:48Z"
labels: ["fix", "infra"]
linkedPrs: []
scope: "platform"
---

# Issue Artifact: #402

## Background

The `forge-require-mfa` IAM policy uses `actions = ["*"]` in its Deny statement. In IAM, an explicit Deny always overrides an Allow, so `iam:ChangePassword` is denied even though the Allow statement grants it. This prevents users (e.g. `tataihono-dev-secrets`) from changing their password on first login when MFA is not yet enrolled.

## Expected outcome

Users can change their password and set up MFA on first console login without hitting "You may not be authorized to perform this action" errors.

## Acceptance criteria

- [x] Deny statement uses `not_actions` (IAM `NotAction`) instead of `actions = ["*"]` to exclude MFA setup and password self-service actions from the deny
- [x] First-login password change and MFA enrollment work for dev-secrets users

## Possible solution(s)

1. Change the Deny statement from `actions = ["*"]` to `not_actions = [list of self-service actions]` so the deny does not apply to MFA setup or password change.

## References

- `infra/aws/iam/groups/require_mfa/main.tf`
- Original setup: #275
- AWS IAM policy evaluation: explicit Deny overrides Allow

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
