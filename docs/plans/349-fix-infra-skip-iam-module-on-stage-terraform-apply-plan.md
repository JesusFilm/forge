---
artifactType: plan
sourceIssueNumber: 349
sourceIssueTitle: "fix(infra): skip IAM module on stage terraform apply"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/349"
linkedPrs: []
---

# Plan Artifact: #349

## Objective

Stage `terraform apply` skips the IAM module entirely. IAM resources are managed exclusively from the prod environment.

## Planned approach

1. Add `count = var.environment == "prod" ? 1 : 0` to the `module "iam"` block in `infra/aws/main.tf`

## Validation

- [ ] `module.iam` is conditionally disabled when `var.environment != "prod"`
- [ ] Stage terraform-apply CI passes without IAM `EntityAlreadyExists` errors
- [ ] Prod terraform-apply still manages IAM resources as before

## Source links

- Issue: [#349](https://github.com/JesusFilm/forge/issues/349)
- PRs:
- None
