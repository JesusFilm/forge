# feat-428 deployment evidence

Verified on August 28, 2026 against `forge/production/@forge/rag` without
recording domains, credentials, headers, connection strings, or corpus text.

## Deployment

- Deployment status: `SUCCESS`
- Deployment ID: `b19d738f-1d9d-46c7-b136-18dd7dac1e49`
- Forge commit: `47159b6938b481f02ec57f469dc6bce023f7ab48`
- Source branch: `main`
- Config file: `/apps/rag/railway.toml`
- Pre-deploy command: `pnpm --filter @forge/rag db:migrate:deploy`
- Start command: `pnpm --filter @forge/rag start`
- Healthcheck: `/v1/health`

The pre-deploy logs loaded the production Prisma schema, found one migration,
reported no pending migrations, and exited before the runtime container
started. The runtime then bound the Hono `/v1` service to Railway's injected
port `8080`.

## Smoke results

| Route           | Health | Missing bearer | Valid bearer | Contract | Results |
| --------------- | -----: | -------------: | -----------: | -------- | ------: |
| Railway private |    200 |            401 |          200 | valid    |       0 |
| Public HTTPS    |    200 |            401 |          200 | valid    |       0 |

The public domain targets port `8080`. The empty corpus makes a deployed
positive/negative source-scope comparison inconclusive; the application tests
prove that requested source scope cannot widen bearer scope and short-circuit
retrieval when the intersection is empty. Repeat the positive deployment probe
after corpus copy as required by the operating runbook.

## Recovery audit note

The 2026-09-04 migration audit found no later committed receipt for that positive
production scope probe. This record therefore remains deliberately
inconclusive; tests are not promoted into deployment evidence. A fresh observed
proof may be attached to `feat-435` without rewriting this historical result.
