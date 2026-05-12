# apps/auth Agent Guide

Full context lives in `apps/auth/CLAUDE.md`. Keep both files aligned.

## Core model

- Standalone Jesus Film Auth authority.
- Owns identity, global membership, app registrations, app-level scopes/grants,
  OAuth/OIDC provider behavior, tokens, audit, and revocation.
- `apps/admin` is the first relying client and must not depend on shared
  `.jesusfilm.org` cookies.
- Deployed as its own Railway service at `auth.jesusfilm.org`.

## Boundaries

- Do not import from `apps/admin`, `apps/web`, `apps/manager`, or other app
  contexts.
- Do not log raw passwords, bearer tokens, refresh tokens, client secrets, or
  unnecessary PII.
- Do not expose public signup while Firebase lazy migration exists.
- Do not make Auth own app-specific domain authorization; apps keep ABAC and
  local permission rules.

## Validation

- `pnpm --filter @forge/auth test`
- `pnpm --filter @forge/auth typecheck`
- `pnpm --filter @forge/auth lint`
