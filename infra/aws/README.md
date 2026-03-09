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
- Sync CMS env vars into `apps/cms/.env.development.local`:
  - `pnpm sync:ssm:dev:cms` (or `pnpm sync:ssm:dev`)
- Sync Web env vars into `apps/web/.env.development.local`:
  - `SSM_SYNC_PATHS_WEB="/forge/aws/web/stage/" pnpm sync:ssm:dev:web`
- Run all app secret fetchers through Turbo:
  - `pnpm fetch-secrets` (runs `fetch-secrets` for `@forge/cms` and `@forge/web`)
  - equivalent direct Turbo command:
    - `turbo run fetch-secrets --filter=@forge/cms --filter=@forge/web`
- Optional custom paths:
  - `SSM_SYNC_PATHS_CMS="/forge/aws/cms/stage/,/forge/aws/cms/prod/" pnpm sync:ssm:dev:cms`
  - `SSM_SYNC_PATHS_WEB="/forge/aws/web/stage/,/forge/aws/web/prod/" pnpm sync:ssm:dev:web`

## Remote state backend

This root expects an S3 backend. Bootstrap backend resources first using `infra/aws/bootstrap-state`, then initialize with shared + environment-specific config (run from repo root):

- Stage: `terraform -chdir=infra/aws init -backend-config=../backend-config/shared.hcl -backend-config=backend-config/stage.hcl -reconfigure`
- Prod: `terraform -chdir=infra/aws init -backend-config=../backend-config/shared.hcl -backend-config=backend-config/prod.hcl -reconfigure`

Apply requires `environment`: `terraform -chdir=infra/aws apply -var="environment=stage"` or `-var="environment=prod"`.

Committed: `infra/backend-config/shared.hcl` (bucket, table, region); `infra/aws/backend-config/stage.hcl` and `prod.hcl` (key only).

`infra/aws/bootstrap-state` is managed manually (not by CI apply workflows).

For full manual IAM/setup/apply steps, use `infra/aws/bootstrap-state/README.md` (canonical runbook).
