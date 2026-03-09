# infra/vercel

Terraform source for Vercel.

## Scope

- Projects, environment variables, domains, preview behavior.
- `STRAPI_API_TOKEN` routing from SSM:
  - `preview` -> `/forge/vercel/strapi_api_token_stage`
  - `production` -> `/forge/vercel/strapi_api_token_prod`

## Rule

No manual Vercel UI configuration.
