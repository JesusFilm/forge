# apps/mastra-gateway Agent Guide

Full context lives in `apps/mastra-gateway/CLAUDE.md`. Keep both files aligned.

## Core model

- Public Forge-authenticated gateway in front of the internal Mastra runtime.
- Uses `apps/auth` as OAuth/OIDC identity provider.
- Owns runtime Mastra Studio access checks while permission management moves to
  the Developer app.
- Proxies authorized Studio traffic to `apps/mastra`.

## Boundaries

- Do not add Mastra Studio access management UI back into this app.
- Do not make Mastra native auth the production SSO/RBAC authority in V1.
- Do not log raw bearer tokens, session cookies, OAuth codes, or model keys.

## Validation

- `pnpm --filter @forge/mastra-gateway test`
- `pnpm --filter @forge/mastra-gateway typecheck`
- `pnpm --filter @forge/mastra-gateway lint`
