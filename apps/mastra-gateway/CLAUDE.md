# apps/mastra-gateway -- Mastra Studio Gateway

## What this app does

Public Next.js gateway for self-hosted Mastra Studio. It authenticates humans
through Forge Auth, stores its own Studio access records, exposes `/admin` for
gateway admins, and proxies authorized Studio traffic to the internal
`apps/mastra` service.

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

- Auth proves identity. This gateway owns Mastra Studio access levels.
- Access levels are `admin` and `editor`.
- `admin` can access Studio and `/admin`; `editor` can access Studio only.
- Keep `apps/admin` out of this access flow.
- Proxy requests to Mastra with a service bearer and never forward browser
  cookies upstream.
- Revalidate the current access record for devotional approval, status, and
  playback requests, including native read-only Studio workflow paths. Approval
  forwards bounded actor attribution to Mastra.
- On both `/api/studio/workflows/daily-support-research/...` and
  `/api/workflows/daily-support-research/...`, freshly revalidate access and
  require `admin`. Launch endpoints accept only bounded dry runs with
  `dryRun=true`, an explicit `maxConversations` of at most 5, and a non-empty
  `idempotencyKey`; live scheduled dispatch is not a browser launch path.
- Use separate, mutually disjoint keys for general Studio proxying, devotional
  approval mutation, and devotional read-only status/playback.

## Environment

| Variable                                | Purpose                                                                 |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `DATABASE_URL`                          | Gateway access-record database.                                         |
| `AUTH_ISSUER_URL`                       | Forge Auth issuer, normally `https://auth.jesusfilm.org`.               |
| `AUTH_MASTRA_STUDIO_CLIENT_ID`          | OAuth client id for this gateway.                                       |
| `AUTH_MASTRA_STUDIO_CLIENT_SECRET`      | Optional OAuth client secret.                                           |
| `MASTRA_GATEWAY_BASE_URL`               | Public base URL for callback and redirects.                             |
| `MASTRA_GATEWAY_SESSION_SECRET`         | HS256 signing secret, at least 32 chars.                                |
| `MASTRA_INTERNAL_BASE_URL`              | Internal URL for the Mastra service.                                    |
| `MASTRA_INTERNAL_API_KEY`               | Bearer sent by the gateway to `apps/mastra`.                            |
| `MASTRA_DEVOTIONAL_APPROVAL_API_KEY`    | Dedicated bearer used only for authenticated human devotional approval. |
| `MASTRA_DEVOTIONAL_PLAYBACK_API_KEY`    | Dedicated bearer used only for devotional status and Range playback.    |
| `MASTRA_GATEWAY_BOOTSTRAP_ADMIN_EMAILS` | Optional CSV of first admin emails.                                     |

## Development

```bash
pnpm --filter @forge/mastra-gateway dev
pnpm --filter @forge/mastra-gateway test
pnpm --filter @forge/mastra-gateway typecheck
pnpm --filter @forge/mastra-gateway lint
```
