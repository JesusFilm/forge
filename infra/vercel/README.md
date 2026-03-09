# infra/vercel

Terraform source for Vercel.

## Scope

- Projects, environment variables, domains, preview behavior.
- `STRAPI_API_TOKEN` routing from SSM:
  - `preview` -> `/forge/aws/cms/stage/STRAPI_INTERNAL_API_TOKEN`
  - `production` -> `/forge/aws/cms/prod/STRAPI_INTERNAL_API_TOKEN`

Prerequisite: `infra/aws` must be applied for both `stage` and `prod` so those
CMS SSM parameters exist before planning/applying `infra/vercel`.

## Rule

No manual Vercel UI configuration.
