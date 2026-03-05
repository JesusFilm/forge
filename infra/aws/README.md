# infra/aws

Terraform source for AWS stacks.

## Scope

- Networking, ECS, RDS PostgreSQL, Redis, S3, secrets, IAM.
- Shared environment for Strapi and AI orchestration.

## Rule

No manual console configuration.

## Remote state backend

This root expects an S3 backend. Bootstrap backend resources first using `infra/aws/bootstrap-state`, then initialize with shared + environment-specific config (run from repo root):

- Stage: `terraform -chdir=infra/aws init -backend-config=../backend-config/shared.hcl -backend-config=backend-config/stage.hcl -reconfigure`
- Prod: `terraform -chdir=infra/aws init -backend-config=../backend-config/shared.hcl -backend-config=backend-config/prod.hcl -reconfigure`

Apply requires `environment`: `terraform -chdir=infra/aws apply -var="environment=stage"` or `-var="environment=prod"`.

Committed: `infra/backend-config/shared.hcl` (bucket, table, region); `infra/aws/backend-config/stage.hcl` and `prod.hcl` (key only).

`infra/aws/bootstrap-state` is managed manually (not by CI apply workflows).

For full manual IAM/setup/apply steps, use `infra/aws/bootstrap-state/README.md` (canonical runbook).
