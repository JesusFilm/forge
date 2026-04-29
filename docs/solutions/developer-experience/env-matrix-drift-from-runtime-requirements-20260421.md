---
title: Env var matrices authored from plan intent drift from actual runtime requirements — derive them from code
date: 2026-04-21
category: developer-experience
problem_type: developer_experience
component: documentation
root_cause: inadequate_documentation
resolution_type: documentation_update
severity: medium
tags: [env-vars, infrastructure, admin, feat-104, railway]
---

## Problem

`feat-104` (admin Railway provisioning) marked several env vars as
"optional for R1": Redis, SSO secrets, Firebase, `CORE_API_TOKEN`,
`GRAPHQL_INTROSPECTION_ENABLED`. The SSO/Firebase/Core entries were
genuinely optional because admin's code gates those providers on
presence (`if (env.FACEBOOK_CLIENT_ID && env.FACEBOOK_CLIENT_SECRET)`).
**Redis was not.** `apps/admin/src/graphql/plugins/rate-limit.ts:45`
throws in production if `REDIS_HOST` or `REDIS_PORT` is missing:

```
Error: REDIS_HOST and REDIS_PORT are required for GraphQL rate limiting
in production.
```

The env matrix reviewed by Nisal and tatai described the deployment
Nisal _intended_ to ship — not the one admin's code _would actually
boot_. The drift stayed hidden through CI, typecheck, 510 admin tests,
and the initial deploy's `/api/health` check (that route doesn't import
the rate-limit plugin). It only surfaced when the first request hit
`/api/graphql` and returned HTTP 500.

## Symptoms

- Deploy succeeds.
- `/api/health` returns 200 — service looks healthy.
- First hit on a real route returns 500 with `"Unexpected error"` in
  the response body and a clear error in server logs:
  `Error: REDIS_HOST and REDIS_PORT are required for GraphQL rate limiting in production.`
- The env matrix document cited as the provisioning trail shows the
  missing var as "Optional for R1."

## Root Cause

An env matrix authored as a **plan artifact** captures the provisioner's
intent at the time of writing. An env matrix derived from the **code's
actual `env.ts` + runtime guards** captures what the app will do on
boot. These two sources diverge quickly — especially when plan authors
and code authors are different people, or when code lands between the
plan draft and provisioning.

In feat-104's case, `apps/admin/src/graphql/plugins/rate-limit.ts`
predated the ticket and always required Redis in production. The plan
writer (writing from the v1 unit-11 spec of "Redis for rate limiting"
→ "optional for R1 smoke") didn't re-read the plugin's guard. The
guard wins at boot time; the plan didn't.

## What Didn't Work

- **Relying on env var defaults in `src/config/env.ts`.** Admin uses
  `t3-oss/env-nextjs` with `.optional()` at the schema layer — so
  `REDIS_HOST` missing passes env validation cleanly. Runtime guards
  at the consumer level (rate-limit plugin) do the actual
  enforcement.
- **Relying on health-check as the smoke signal.** `/api/health` is
  a trivial `NextResponse.json({ status: "ok" })` that doesn't
  import the GraphQL plugin chain. A healthy healthcheck means the
  server booted, not that every route works.

## Solution

**Derive the env matrix from code, not from plan intent.** Before
signing off any service provisioning:

1. List every call to `env.XYZ` across the service.
2. For each, check whether it's wrapped in a conditional or consumed
   unconditionally. Unconditional consumers are required; conditional
   consumers are optional.
3. Specifically audit any `throw new Error(...required...)` patterns —
   those are hard-stops regardless of how "optional" the var looks
   in docs.
4. The resulting list is the ground truth. Reconcile the plan matrix
   against it before committing.

Immediate fix applied:

- Provisioned `@forge/admin/redis` on Railway as a Bitnami Redis
  template in us-west2.
- Wired `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` on
  `@forge/admin` as reference variables to the new Redis service.
- Redeployed — `/api/graphql` now returns clean JSON responses
  instead of 500.

## Why This Works

The env matrix is a communication artifact: it tells the provisioner
what to set. When the matrix lists something optional but the app
crashes without it, the matrix is lying. The only anti-lying check
is reading the code that consumes each var. Any process that
produces an env matrix without that audit produces lies proportional
to the distance between plan author and code author.

## Prevention

### Authoring checklist for future provisioning tickets

Before merging a provisioning ticket (`feat-NNN-service-provisioning.md`):

- [ ] Grep the service for `env.` / `process.env.` consumers and
      enumerate them.
- [ ] For each consumer, classify: **required (unconditional)**,
      **conditional (feature-flag shape)**, or **dev-only**.
- [ ] For each **required** var, grep for `throw.*required\|Missing.*env\|required in production`
      inside the service source tree. Anything that matches is a
      hard production gate — put it in the REQUIRED section of the
      matrix with no "optional for R1" caveat.
- [ ] Diff the resulting list against the matrix in the ticket.
      Reconcile silently-added/removed items.

### Detection signal during provisioning

After the first deploy goes green (healthcheck 200):

- **Hit every route group the service exposes,** not just
  `/api/health`. A Next.js app has `/api/*` handlers, page routes,
  server actions — each can pull in different modules and trigger
  different env guards.
- For GraphQL services, the moment `/api/graphql` is proxied by the
  first real mutation call is when the real env surface loads.
- If a route returns 500 with Yoga's masked `"Unexpected error"`,
  **assume a missing env var before assuming code bug.** The server
  logs will show the actual guard error — that's the tell.

### Why we don't try to auto-generate the matrix

Tooling exists (e.g. `t3-oss/env-nextjs`'s schema) to assert "these
vars must exist," but the required/optional decision for a
provisioning ticket also depends on the deployment's feature scope
(e.g., SSO is genuinely optional if the deploy is email/password
only). A generator produces the superset; human judgment trims it.
The audit step above is the cheapest honest version.

## Related

- `docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md`
  — sibling pattern from the same R1 smoke session. Green CI missed
  a dispatch-site bug; green healthcheck missed a Redis gate. Same
  meta-shape.
- `docs/solutions/best-practices/verify-infra-writes-via-independent-read-path-20260420.md`
  — the meta-pattern from PR #808. "Read the thing the consumer
  actually uses" applies here too: the env matrix read from plan
  intent vs from code is the same class of error.
- `docs/roadmap/platform/feat-104-admin-railway-provisioning.md`
  — the provisioning ticket whose matrix contained the drift.
