# infra/aws

Terraform source for AWS stacks.

## Scope

- Networking, ECS, RDS PostgreSQL, Redis, S3, secrets, IAM.
- Shared environment for Strapi and AI orchestration.

## Rule

No manual console configuration.

## CMS secrets sync

- CMS runtime secrets are sourced from Doppler project `cms` (`stage`/`prod`) and synced into SSM Parameter Store paths:
  - `/forge/cms/stage/APP_KEYS`
  - `/forge/cms/stage/ADMIN_JWT_SECRET`
  - `/forge/cms/stage/API_TOKEN_SALT`
  - `/forge/cms/stage/TRANSFER_TOKEN_SALT`
  - `/forge/cms/stage/ENCRYPTION_KEY`
  - same keys under `/forge/cms/prod/*` for production.
- ECS task definition reads those SSM parameters as container secrets.
- Workflow `.github/workflows/cms-secrets-sync.yml` performs sync and forces ECS rolling deployment so fresh values are loaded immediately.
- Required GitHub secrets:
  - `DOPPLER_TOKEN_CMS_STAGE`
  - `DOPPLER_TOKEN_CMS_PROD`
  - `AWS_ROLE_ARN_CMS_STAGE`
  - `AWS_ROLE_ARN_CMS_PROD`
