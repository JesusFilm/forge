# apps/cms

Strapi v5 CMS application and schema source of truth.

## Boundary

- Owns canonical content + workflow states.
- AI outputs must land in draft/variant records only.
- Publish transition is human-only and role-gated.

## Web integration

- **Preview**: Strapi's preview handler (`config/admin.ts`) redirects editors to `apps/web` GET `/api/preview?secret=...&url=/path&status=draft|published`. Secret must match `PREVIEW_SECRET` (CMS) / `STRAPI_PREVIEW_SECRET` (web).

## Secrets

- CMS runtime secrets are sourced from Railway service variables.
- CI deploy auth is sourced from GitHub Actions secrets/variables used by `.github/workflows/cms-deploy.yml`.
- `scripts/fetch-secrets.ts --project cms` is deprecated and intentionally unsupported.
