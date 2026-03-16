---
artifactType: plan
sourceIssueNumber: 198
sourceIssueTitle: "fix(infra): grant CMS ECS execution role Secrets Manager access for RDS secret"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/198"
linkedPrs: []
---

# Plan Artifact: #198

## Objective

CMS ECS tasks start successfully and can read the RDS secret from Secrets Manager at container launch.

## Planned approach

1. Add an IAM policy document and role policy attached to the existing CMS ECS execution role, scoped to `aws_db_instance.cms.master_user_secret[0].secret_arn` (same resource already used for task-role secrets).

## Validation

- [ ] CMS ECS execution role has an identity-based policy allowing `secretsmanager:GetSecretValue` and `secretsmanager:DescribeSecret` on the RDS master user secret ARN.
- [ ] No change to task role or other resources beyond execution role secrets policy.
- [ ] Terraform apply succeeds; ECS tasks for CMS (e.g. prod) can pull the secret and start.

## Source links

- Issue: [#198](https://github.com/JesusFilm/forge/issues/198)
- PRs:
- None
