# infra/aws

Terraform source for AWS stacks.

## Scope

- Networking, ECS, RDS PostgreSQL, Redis, S3, secrets, IAM.
- Shared environment for Strapi and AI orchestration.

## Rule

No manual console configuration.

## Dev credentials + SSM sync

- Dev credential IAM users are list-driven in `infra/aws/iam/users/dev_credentials_users.tf`.
- Username format is `<github-handle>-dev-credentials`.
- Existing IAM users are managed separately and are intentionally unchanged.
- Dev credential permissions are in group `forge-dev-credentials` (Terraform module: `infra/aws/iam/groups/dev_credentials`).
- Refresh contributor handles (12-month humans, exclude bots) with:
  - `git shortlog -sne --since="12 months ago" --all`
- Sync local dev env vars from SSM:
  - `pnpm sync:ssm:dev`
- Optional custom paths:
  - `SSM_SYNC_PATHS="/forge/aws/cms/stage/,/forge/aws/cms/prod/" pnpm sync:ssm:dev`

## Remote state backend

This root expects an S3 backend. Bootstrap backend resources first using `infra/aws/bootstrap-state`, then initialize with shared + environment-specific config (run from repo root):

- Stage: `terraform -chdir=infra/aws init -backend-config=../backend-config/shared.hcl -backend-config=backend-config/stage.hcl -reconfigure`
- Prod: `terraform -chdir=infra/aws init -backend-config=../backend-config/shared.hcl -backend-config=backend-config/prod.hcl -reconfigure`

Apply requires `environment`: `terraform -chdir=infra/aws apply -var="environment=stage"` or `-var="environment=prod"`.

Committed: `infra/backend-config/shared.hcl` (bucket, table, region); `infra/aws/backend-config/stage.hcl` and `prod.hcl` (key only).

`infra/aws/bootstrap-state` is managed manually (not by CI apply workflows).

For full manual IAM/setup/apply steps, use `infra/aws/bootstrap-state/README.md` (canonical runbook).
