# apps/mastra-gateway -- Mastra Studio Gateway

## What this app does

Public Next.js gateway for self-hosted Mastra Studio. It authenticates humans
through Forge Auth, performs runtime Studio access checks, and proxies
authorized Studio traffic to the internal `apps/mastra` service. Permission
management is being centralized in Developer, not edited inside this gateway.

Origin documents:

- Requirements: `docs/brainstorms/2026-05-22-mastra-railway-workflow-runtime-requirements.md`
- Plan: `docs/plans/2026-05-22-001-feat-mastra-railway-runtime-plan.md`
- Roadmap: `docs/roadmap/platform/feat-129-mastra-railway-workflow-runtime.md`

## Stack

- Next.js 16+ App Router with TypeScript strict mode
- Forge Auth OAuth/OIDC relying-client flow
- Prisma + Postgres for gateway-owned access records
- Railway deployment with standalone output

## Architecture rules

- Auth proves identity. This gateway enforces Mastra Studio access at runtime.
- Access levels are `admin` and `editor`.
- This app must not expose local access-management UI.
- Keep `apps/admin` out of this access flow.
- Proxy requests to Mastra with a service bearer and never forward browser
  cookies upstream.

## Environment

| Variable                           | Purpose                                                   |
| ---------------------------------- | --------------------------------------------------------- |
| `DATABASE_URL`                     | Gateway access-record database.                           |
| `AUTH_ISSUER_URL`                  | Forge Auth issuer, normally `https://auth.jesusfilm.org`. |
| `AUTH_MASTRA_STUDIO_CLIENT_ID`     | OAuth client id for this gateway.                         |
| `AUTH_MASTRA_STUDIO_CLIENT_SECRET` | Optional OAuth client secret.                             |
| `MASTRA_GATEWAY_BASE_URL`          | Public base URL for callback and redirects.               |
| `MASTRA_GATEWAY_SESSION_SECRET`    | HS256 signing secret, at least 32 chars.                  |
| `MASTRA_INTERNAL_BASE_URL`         | Internal URL for the Mastra service.                      |
| `MASTRA_INTERNAL_API_KEY`          | Bearer sent by the gateway to `apps/mastra`.              |

## Development

```bash
pnpm --filter @forge/mastra-gateway dev
pnpm --filter @forge/mastra-gateway test
pnpm --filter @forge/mastra-gateway typecheck
pnpm --filter @forge/mastra-gateway lint
```
