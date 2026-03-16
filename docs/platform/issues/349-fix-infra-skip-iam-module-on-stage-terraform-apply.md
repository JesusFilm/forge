---
artifactType: issue
issueNumber: 349
issueTitle: "fix(infra): skip IAM module on stage terraform apply"
issueUrl: "https://github.com/JesusFilm/forge/issues/349"
state: "CLOSED"
closedAt: "2026-03-11T01:03:07Z"
labels: ["fix", "infra"]
linkedPrs: []
scope: "platform"
---

# Issue Artifact: #349

## Background

Stage `terraform-apply` fails with `EntityAlreadyExists` for all IAM groups and the MFA policy. IAM resources are global (not per-environment) and are already managed by the prod state. Running the IAM module on stage attempts to re-create resources that prod already owns, causing conflicts.

Failed run errors:

- `forge-admin-readonly` group already exists
- `forge-billing` group already exists
- `forge-dev-secrets` group already exists
- `forge-iam-login-profile` group already exists
- `forge-require-mfa` policy already exists

## Expected outcome

Stage `terraform apply` skips the IAM module entirely. IAM resources are managed exclusively from the prod environment.

## Acceptance criteria

- [ ] `module.iam` is conditionally disabled when `var.environment != "prod"`
- [ ] Stage terraform-apply CI passes without IAM `EntityAlreadyExists` errors
- [ ] Prod terraform-apply still manages IAM resources as before

## Possible solution(s)

1. Add `count = var.environment == "prod" ? 1 : 0` to the `module "iam"` block in `infra/aws/main.tf`

## References

- Failed stage apply: terraform-apply workflow on `stage` branch
- Related: #338 (prior IAM permission fixes for terraform apply)

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
