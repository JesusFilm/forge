---
title: "Mastra Studio Gateway Auth on Railway"
category: platform
date: 2026-05-22
tags:
  - mastra
  - railway
  - auth
  - oauth
  - studio
  - service-bearer
  - gateway
components:
  - apps/mastra
  - apps/mastra-gateway
  - apps/auth
  - railway.toml
severity: high
related:
  - docs/solutions/platform/new-app-ci-and-deployment-patterns.md
  - docs/solutions/auth/admin-sso-uses-oauth-local-session-not-shared-cookies.md
  - docs/solutions/architecture-patterns/bearer-as-passport-multi-csv-composition-20260518.md
---

# Mastra Studio Gateway Auth on Railway

## Context

Mastra Studio production SSO/RBAC should not be the V1 dependency for a
self-hosted Forge deployment. Keep Forge Auth as the identity provider, run
Mastra Server internally, and expose Studio through a first-party Next.js
gateway that owns the Studio access list.

## Guidance

Use two Railway services:

- `apps/mastra` runs Mastra Server, builds Studio assets with
  `mastra build --studio`, and protects server/API routes with
  `MASTRA_SERVICE_API_KEYS`.
- `apps/mastra-gateway` is the public service. It performs OAuth code + PKCE
  against `apps/auth`, stores a gateway-local session cookie, manages
  gateway-local Studio access records, and proxies authenticated requests to the
  internal Mastra service with `MASTRA_INTERNAL_API_KEY`.

This keeps the ownership boundaries clear:

- Auth owns identity, scopes, and OAuth client registration.
- Gateway owns who can open Studio and who can manage Studio access.
- Mastra owns agents, workflows, and service-bearer API execution.
- Product apps such as Manager call Mastra through service bearer contracts;
  they do not rely on browser Studio sessions.

Register the gateway as a normal first-party Auth app with its own scope, for
example `mastra-studio:access`. That scope says the user may attempt to enter
the Studio gateway. The gateway database still decides whether they are
`admin`, `editor`, `pending`, or `revoked`.

Railway PR preview hostnames must be treated as wildcarded preview hosts, not as
one static seed URL. Keep one baseline preview URL in the first-party seed, then
use Auth's dynamic preview redirect policy to validate generated hosts such as
`https://forge-mastra-studio-pr-123.up.railway.app/api/auth/callback` and
persist that exact redirect URI just-in-time. Do not store a broad
`*.up.railway.app` redirect URI.

## Why This Matters

Putting Studio behind the gateway avoids taking a dependency on Mastra native
production SSO/RBAC licensing for the first self-deploy slice. It also avoids
mixing Studio access management into `apps/admin`, which would couple an
infrastructure operator surface to an editorial admin product.

The service bearer layer remains necessary even when Railway networking is
private. It gives Manager, scripts, and future workers an explicit contract for
agent execution, and it gives Mastra a second line of defense if the service is
ever exposed more broadly than intended.

## When To Apply

Apply this pattern when introducing a third-party operational UI that should be
reachable by internal users but should not own Forge identity, user management,
or product roles.

Use a gateway-local access table when the permission is specific to that
operational surface. Reuse `apps/admin` only when the permission is truly an
Admin product permission.

## Examples

Railway start commands should match each framework's build output. Mastra's CLI
prints an app-local start command, so the Railway service can run from the app
directory:

```toml
[deploy]
startCommand = "cd apps/mastra && MASTRA_STUDIO_PATH=.mastra/output/studio node .mastra/output/index.mjs"
```

For Next.js standalone services, copy static assets into the standalone output
and run migrations before starting the gateway:

```toml
[build]
buildCommand = "pnpm install --frozen-lockfile && pnpm --filter @forge/mastra-gateway build && cp -r apps/mastra-gateway/.next/static apps/mastra-gateway/.next/standalone/apps/mastra-gateway/.next/static"

[deploy]
startCommand = "pnpm --filter @forge/mastra-gateway db:migrate:deploy && HOSTNAME=0.0.0.0 node apps/mastra-gateway/.next/standalone/apps/mastra-gateway/server.js"
```

Keep the gateway admin UI minimal: list access requests, approve users as
`editor` or `admin`, update roles, and revoke access. Editors can open Studio;
admins can open Studio and `/admin`.
