---
id: "feat-561"
title: "Restore Auth staging deployment health"
owner: "nisal"
priority: "P2"
status: "not-started"
start_date: "2026-09-29"
duration: 2
depends_on: []
blocks: []
tags:
  - "auth"
  - "infrastructure"
  - "operations"
---

## Problem

The September 28 recommendation merge review found a pre-existing Auth staging
deployment failure. Deployment `b3f9cfc1-9647-4983-b483-6664a7c26431` at commit
`c7b8958d6f22a650e4ca9f75bc0f96e559a27bff` built successfully and started Next.js,
but Railway's `/api/health` checks repeatedly returned HTTP 503. The four earlier
deployments at `32e6ad6`, `b97c9bb`, `779a21b` and `2e7e5ab` were also `FAILED`,
before this batch's merges. Their underlying causes were not inspected.

This is environment `stage` (`3c508519-e1d5-430a-be27-64477f9594e9`) in project
`forge` (`98952497-a4d9-4714-8fe8-0cdbff3147c9`), service `@forge/auth`
(`28b7c7be-3a22-4a95-885a-bc302e3d16a2`). Production Auth's health endpoint
returned HTTP 200 with `ok: true` during the review. Do not infer a production
outage or assume the documented absence of a staging database is the cause.

## Entry Points — Read These First

1. `apps/auth/AGENTS.md` and `apps/auth/CLAUDE.md` — Auth execution boundaries.
2. `apps/auth/railway.toml` — intentional production/stage config-as-code
   asymmetry and historical staging database constraints.
3. `apps/auth/src/app/api/health/route.ts` — bounded `auth.$context` readiness;
   initialization rejection or timeout produces HTTP 503.
4. `apps/auth/src/auth/config.ts` and `apps/auth/src/config/env.ts` — determine
   which initialization dependency fails in the actual staging configuration.
5. `apps/auth/docs/railway-deployment.md` — deployment and rollback contracts.
6. `docs/operations/recommendation-batch-review-2026-09-28.md` — bounded discovery
   evidence and distinction from recommendation acceptance.

## Grep These

- `auth.\$context|Promise.race|5000` in the health route and its tests.
- `AUTH_BASE_URL|DATABASE_URL|discovery|issuer` in Auth initialization.
- `stage|Config-as-code|healthcheckPath` in deployment guidance.

## What To Build

- Reconfirm the exact staging service/environment and compare its effective
  startup configuration with the documented intended staging architecture.
  Inspect bounded build/runtime logs and readiness behavior without printing
  secret values or identity records.
- Distinguish initialization rejection from its five-second timeout; identify
  the failed dependency before choosing a repair. The current sanitized runtime
  sample only showed Next.js ready messages, not the underlying exception.
- Apply the smallest evidenced repair through a focused PR. Keep readiness
  truthful; do not return healthy while Auth initialization is broken.
- Add a regression at the failing boundary and document any intentional change
  to the staging architecture separately from production configuration.

## Constraints

- No production Auth configuration changes, database provisioning, credentials
  changes or manual deployment are implied by this ticket.
- Preserve the production/staging migration distinction in `railway.toml`.
- Use the normal PR-to-main deployment path. Do not disable the healthcheck,
  suppress initialization errors or introduce a startup bypass to make it green.
- This follow-up does not block the reviewed recommendation feature merges and
  does not close their independent evidence gates.

## Verification

- Reproduce the diagnosed failure in an isolated fixture and demonstrate the
  targeted regression fails before the repair and passes afterward.
- Run affected Auth tests, typechecking, formatting and CI before merge.
- After ordinary deployment, confirm the exact staging deployment is healthy,
  `/api/health` returns HTTP 200, and discovery plus a representative authorized
  staging login complete. Keep production health verification read-only.
- Record deployment identity, configuration assumptions, bounded diagnostics
  and any remaining gaps without secrets or user data.
