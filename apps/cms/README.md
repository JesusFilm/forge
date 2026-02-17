# apps/cms

Strapi v5 CMS application and schema source of truth.

## Boundary

- Owns canonical content + workflow states.
- AI outputs must land in draft/variant records only.
- Publish transition is human-only and role-gated.

## Web integration

- **Revalidate**: `apps/web` POST `/api/revalidate` expects `x-forge-revalidate-token` header (future Strapi webhook on publish). Token must match `STRAPI_REVALIDATE_TOKEN` in web's env.
- **Preview**: `apps/web` GET `/api/preview?token=...&redirect=/` enables draft mode. Token must match `STRAPI_PREVIEW_TOKEN` in web's env.
