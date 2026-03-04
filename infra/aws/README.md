# infra/aws

Terraform source for AWS stacks.

## Scope

- Networking, ECS, RDS PostgreSQL, Redis, S3, secrets, IAM.
- Shared environment for Strapi and AI orchestration.

## Rule

No manual console configuration.

## Remote state backend

This root expects an S3 backend. Bootstrap backend resources first using `infra/aws/bootstrap-state`, then initialize this root with an environment-specific backend config:

- `terraform -chdir=infra/aws init -backend-config=backend-config/stage.hcl`
- `terraform -chdir=infra/aws init -backend-config=backend-config/prod.hcl`

Committed backend configs:

- `infra/aws/backend-config/stage.hcl`
- `infra/aws/backend-config/prod.hcl`

`infra/aws/bootstrap-state` is managed manually (not by CI apply workflows).

For full manual IAM/setup/apply steps, use `infra/aws/bootstrap-state/README.md` (canonical runbook).
