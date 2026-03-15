# CMS Railway Cutover Runbook

This runbook assumes a hard cutover from AWS-hosted CMS to Railway-hosted CMS.

## 1) Pre-cutover checklist

- Railway CMS service created from `apps/cms/Dockerfile`.
- Railway Postgres provisioned.
- Railway S3-compatible bucket provisioned.
- Required CMS env vars set in Railway service variables (`apps/cms/.env.example`).
- `RAILWAY_CMS_DEPLOY_TOKEN`, `RAILWAY_PROJECT_ID`, `RAILWAY_ENV_*`, and `RAILWAY_CMS_SERVICE_*` configured in GitHub Actions.

## 2) Database migration (RDS -> Railway Postgres)

1. Put CMS into maintenance window (freeze content writes).
2. Export AWS RDS snapshot:
   - `pg_dump --format=custom --no-owner --no-privileges --dbname="$AWS_DATABASE_URL" --file cms.dump`
3. Import into Railway Postgres:
   - `pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$RAILWAY_DATABASE_URL" cms.dump`
4. Verify row counts for core tables (`admin_users`, `up_permissions_permission`, `files`, content tables).

## 3) Media migration (S3 -> Railway S3-compatible)

1. Sync existing objects:
   - `aws s3 sync s3://<old-bucket>/cms/ ./cms-media`
2. Upload into Railway object storage bucket/prefix:
   - `aws s3 sync ./cms-media s3://<railway-bucket>/cms/ --endpoint-url "$RAILWAY_S3_ENDPOINT"`
3. Validate object accessibility from CMS upload plugin using Railway endpoint/CDN URL.

## 4) Token and preview secret alignment

- Ensure CMS has `STRAPI_INTERNAL_API_TOKEN` set in Railway env.
- Update web consumer secret/token values to match new CMS:
  - `STRAPI_API_TOKEN`
  - `NEXT_PUBLIC_GRAPHQL_URL`
  - `NEXT_PUBLIC_CMS_HOSTNAME`
  - `STRAPI_PREVIEW_SECRET` (must equal CMS `PREVIEW_SECRET`)

## 5) Deploy and smoke test

1. Trigger `cms-deploy` workflow on `stage`.
2. Validate:
   - Admin login
   - GraphQL query success
   - File upload + retrieval
   - Resend email send succeeds
   - Preview redirect into web works
3. Repeat on `main` once stage is green.

## 6) Finalize cutover

- Confirm no writes are going to old AWS CMS.
- Decommission old CMS runtime infra.
- Proceed with repo cleanup tasks (legacy infra folder removal and stale workflow/docs references).
