---
id: "feat-551"
title: "Make Auth discovery independent of initialization"
owner: "edmondshen"
priority: "P0"
status: "complete"
start_date: "2026-09-25"
duration: 1
depends_on: []
blocks: []
tags: ["auth", "reliability"]
---

## Problem

The mobile self-RP provider fetches Auth's own OIDC discovery document during
initialization. The document currently awaits that same initialization. A failed
discovery poisons the shared Auth context, causing subsequent authorization
requests to return HTTP 500 while Railway's health endpoint reports success.

## Entry Points

- `apps/auth/src/auth/config.ts`: self-RP discovery and advertised metadata.
- `apps/auth/src/app/.well-known/openid-configuration/route.ts`: public discovery.
- `apps/auth/src/app/api/health/route.ts`: Railway readiness.

## What To Build

Serve configuration-only discovery independently of Auth initialization. Fetch
it through this container’s loopback port so rollout cannot hit the previous
deployment or CDN. Share
advertised scopes, claims and signing algorithm with the provider. Preserve the
full existing discovery contract with an exact parity test against the real
provider. Make health fail when initialization fails or exceeds a bounded wait.

## Constraints

Preserve issuer, public PKCE client registration and ID-token signature
verification. No production database or configuration changes. Release through
the normal PR-to-main deployment flow.

## Verification

Use a disposable PostgreSQL database and real local HTTP discovery to reproduce
the cold-start failure before the fix and prove initialization after it. Check
discovery parity, session requests, readiness failures, Auth tests, typecheck,
lint, formatting and a production build. Verify production after merge.

## Results

- All 689 Auth tests passed across 56 files against disposable PostgreSQL.
- Typecheck, lint and production build passed.
- The real standalone server returned readiness 200 and session 200 with an
  unreachable public hostname; discovery retained that public issuer.
- Exact metadata parity and ID-token verification settings passed against the
  real provider. Readiness rejection and timeout return 503.
- Production verification remains pending the normal PR merge and deployment.
