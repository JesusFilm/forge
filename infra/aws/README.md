# infra/aws

Terraform source for AWS stacks.

## Scope

- Networking, ECS, RDS PostgreSQL, Redis, S3, secrets, IAM.
- Shared environment for Strapi and AI orchestration.

## Rule

No manual console configuration.

## Dev secrets + SSM sync

- Dev secret IAM users are list-driven in `infra/aws/iam/users/dev_secrets_users.tf`.
- Username format is `<github-handle>-dev-secrets`.
- Existing IAM users are managed separately and are intentionally unchanged.
- Dev secret permissions are in group `forge-dev-secrets` (Terraform module: `infra/aws/iam/groups/dev_secrets`).
- Refresh contributor handles (12-month humans, exclude bots) with:
  - `git shortlog -sne --since="12 months ago" --all`
- Sync CMS env vars into `apps/cms/.env.development.local`:
  - `pnpm fetch-secrets:cms`
- Sync Web env vars into `apps/web/.env.development.local`:
  - `SSM_SYNC_PATHS_WEB="/forge/aws/web/stage/" pnpm fetch-secrets:web`
- Run all app secret fetchers through Turbo:
  - `pnpm fetch-secrets` (runs `fetch-secrets` for `@forge/cms` and `@forge/web`)
  - equivalent direct Turbo command:
    - `turbo run fetch-secrets --filter=@forge/cms --filter=@forge/web`
- Optional custom paths:
  - `SSM_SYNC_PATHS_CMS="/forge/aws/cms/stage/,/forge/aws/cms/prod/" pnpm fetch-secrets:cms`
  - `SSM_SYNC_PATHS_WEB="/forge/aws/web/stage/,/forge/aws/web/prod/" pnpm fetch-secrets:web`

## Remote state backend

This root expects an S3 backend. Bootstrap backend resources first using `infra/aws/bootstrap-state`, then initialize with shared + environment-specific config (run from repo root):

- Stage: `terraform -chdir=infra/aws init -backend-config=../backend-config/shared.hcl -backend-config=backend-config/stage.hcl -reconfigure`
- Prod: `terraform -chdir=infra/aws init -backend-config=../backend-config/shared.hcl -backend-config=backend-config/prod.hcl -reconfigure`

Apply requires `environment`: `terraform -chdir=infra/aws apply -var="environment=stage"` or `-var="environment=prod"`.

Committed: `infra/backend-config/shared.hcl` (bucket, table, region); `infra/aws/backend-config/stage.hcl` and `prod.hcl` (key only).

`infra/aws/bootstrap-state` is managed manually (not by CI apply workflows).

For full manual IAM/setup/apply steps, use `infra/aws/bootstrap-state/README.md` (canonical runbook).
