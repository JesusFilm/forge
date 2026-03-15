# CMS Railway Cutover Runbook

This runbook assumes a hard cutover from AWS-hosted CMS to Railway-hosted CMS.

## 1) Pre-cutover checklist

- Railway CMS service created from `apps/cms/railway.toml`.
- Railway Postgres provisioned.
- Railway S3-compatible bucket provisioned.
- Required CMS env vars set in Railway service variables (`apps/cms/.env.example`).
- You can seed variables from `apps/cms/railway.variables.env` (uses `${{secret(...)}}` placeholders for secrets where supported).
- Deployment access available via Railway CLI or Railway dashboard.

## 2) Database strategy (fresh start)

1. Do not migrate data from AWS RDS.
2. Start CMS against a clean Railway Postgres database.
3. Create required admin user(s), API token(s), and baseline CMS settings directly in Railway-hosted CMS.

## 3) Media strategy

1. Do not sync media from AWS S3.
2. Start with empty Railway S3-compatible storage and upload new assets after cutover.
3. Validate upload and read paths from CMS admin.

## 4) Token and preview secret alignment

- Ensure CMS has `STRAPI_INTERNAL_API_TOKEN` set in Railway env.
- Update web consumer secret/token values to match new CMS:
  - `STRAPI_API_TOKEN`
  - `NEXT_PUBLIC_GRAPHQL_URL`
  - `NEXT_PUBLIC_CMS_HOSTNAME`
  - `STRAPI_PREVIEW_SECRET` (must equal CMS `PREVIEW_SECRET`)

## 5) Deploy and smoke test

1. Deploy CMS to stage from Railway (`railway up` in `apps/cms`) or via Railway dashboard.
2. Validate:
   - Admin login
   - GraphQL query success
   - File upload + retrieval
   - Resend email send succeeds
   - Preview redirect into web works
3. Promote/redeploy to production once stage is green.

## 6) Finalize cutover

- Confirm no writes are going to old AWS CMS.
- Decommission old CMS runtime infra.
- Proceed with repo cleanup tasks (legacy infra folder removal and stale workflow/docs references).
