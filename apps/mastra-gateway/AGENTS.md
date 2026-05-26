# apps/mastra-gateway Agent Guide

Full context lives in `apps/mastra-gateway/CLAUDE.md`. Keep both files aligned.

## Core model

- Public Forge-authenticated gateway in front of the internal Mastra runtime.
- Uses `apps/auth` as OAuth/OIDC identity provider.
- Owns its own Mastra Studio access records, access requests, and `/admin`
  management UI.
- Proxies authorized Studio traffic to `apps/mastra`.

## Boundaries

- Do not use `apps/admin` for Mastra Studio access management.
- Do not make Mastra native auth the production SSO/RBAC authority in V1.
- Do not log raw bearer tokens, session cookies, OAuth codes, or model keys.

## Validation

- `pnpm --filter @forge/mastra-gateway test`
- `pnpm --filter @forge/mastra-gateway typecheck`
- `pnpm --filter @forge/mastra-gateway lint`
