---
artifactType: issue
issueNumber: 198
issueTitle: "fix(infra): grant CMS ECS execution role Secrets Manager access for RDS secret"
issueUrl: "https://github.com/JesusFilm/forge/issues/198"
state: "CLOSED"
closedAt: "2026-03-04T10:43:42Z"
labels: ["fix", "infra"]
linkedPrs: []
---

# Issue Artifact: #198

## Background

ECS tasks for CMS fail at startup with `ResourceInitializationError: unable to pull secrets or registry auth` and `AccessDeniedException` on `secretsmanager:GetSecretValue` for the RDS master user secret. The task definition injects `DATABASE_PASSWORD` via the `secrets` block, which ECS resolves using the **execution role**, not the task role.

## Expected outcome

CMS ECS tasks start successfully and can read the RDS secret from Secrets Manager at container launch.

## Acceptance criteria

- [ ] CMS ECS execution role has an identity-based policy allowing `secretsmanager:GetSecretValue` and `secretsmanager:DescribeSecret` on the RDS master user secret ARN.
- [ ] No change to task role or other resources beyond execution role secrets policy.
- [ ] Terraform apply succeeds; ECS tasks for CMS (e.g. prod) can pull the secret and start.

## Possible solution(s)

1. Add an IAM policy document and role policy attached to the existing CMS ECS execution role, scoped to `aws_db_instance.cms.master_user_secret[0].secret_arn` (same resource already used for task-role secrets).

## References

- `infra/aws/modules/cms/main.tf` – execution role, task definition with `secrets`, RDS instance.
- Related: Terraform apply role already has Secrets Manager permissions (#197).

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
