# infra/aws

Terraform source for AWS stacks.

## Scope

- Networking, ECS, RDS PostgreSQL, Redis, S3, secrets, IAM.
- Shared environment for Strapi and AI orchestration.

## Rule

No manual console configuration.

## Dev secrets + SSM sync

- Dev secret IAM users are list-driven in `infra/aws/iam/users/dev_secrets/main.tf`.
- Username format is `<github-handle>-dev-secrets`.
- Existing IAM users are managed separately and are intentionally unchanged.
- Dev secret permissions are in group `forge-dev-secrets` (Terraform module: `infra/aws/iam/groups/dev_secrets`).
- Dev SSM sources are:
  - CMS: `/forge/aws/cms/dev/*`
  - Web: `/forge/aws/web/dev/*`
- Refresh contributor handles (12-month humans, exclude bots) with:
  - `gh api repos/JesusFilm/forge/contributors --paginate --jq '.[].login' | sort -u`
- Sync CMS env vars into `apps/cms/.env`:
  - `cd apps/cms && pnpm fetch-secrets`
- Sync Web env vars into `apps/web/.env.development.local`:
  - `cd apps/web && pnpm fetch-secrets`
- Run all app secret fetchers through Turbo:
  - `pnpm fetch-secrets`
  - equivalent direct Turbo command:
    - `turbo run fetch-secrets`

## Remote state backend

This root expects an S3 backend. Bootstrap backend resources first using `infra/aws/bootstrap-state`, then initialize with shared + environment-specific config (run from repo root):

- Stage: `terraform -chdir=infra/aws init -backend-config=../backend-config/shared.hcl -backend-config=backend-config/stage.hcl -reconfigure`
- Prod: `terraform -chdir=infra/aws init -backend-config=../backend-config/shared.hcl -backend-config=backend-config/prod.hcl -reconfigure`

Apply requires `environment`: `terraform -chdir=infra/aws apply -var="environment=stage"` or `-var="environment=prod"`.

Committed: `infra/backend-config/shared.hcl` (bucket, table, region); `infra/aws/backend-config/stage.hcl` and `prod.hcl` (key only).

`infra/aws/bootstrap-state` is managed manually (not by CI apply workflows).

For full manual IAM/setup/apply steps, use `infra/aws/bootstrap-state/README.md` (canonical runbook).
