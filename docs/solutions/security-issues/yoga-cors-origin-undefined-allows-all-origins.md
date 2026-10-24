---
title: "GraphQL Yoga CORS with origin:undefined reflects any origin — fail closed with cors:false"
category: security-issues
date: 2026-04-14
tags:
  - graphql
  - yoga
  - cors
  - security
  - admin
problem_type: security_issue
component: apps/admin/src/app/api/graphql/route.ts
---

## Problem

The Yoga CORS config used `origin: undefined` as a fallback when
`CORS_ALLOWED_ORIGINS` was empty:

```ts
cors: {
  origin: corsOrigins.length > 0 ? corsOrigins : undefined,
  credentials: true,
}
```

`@whatwg-node/server`'s useCors checks `corsOptions.origin == null`
(which matches `undefined`), and when true, reflects the requesting
`Origin` header verbatim as `Access-Control-Allow-Origin`. Combined
with `credentials: true`, this allows any website to make cookie-
bearing cross-origin requests to the GraphQL API — a full CSRF vector.

## Root cause

The CORS origin allowlist was env-driven and optional. A deployment that
forgot to set `CORS_ALLOWED_ORIGINS` silently degraded to allow-all.
`undefined` in JavaScript's CORS ecosystem typically means "not
configured" but Yoga/whatwg-node interprets it as "wildcard."

## Solution

Fail closed: when no origins are configured, disable CORS entirely:

```ts
const corsConfig = corsOrigins.length > 0
  ? { origin: corsOrigins, credentials: true, methods: ["GET", "POST", "OPTIONS"] }
  : false

const yoga = createYoga({ cors: corsConfig, ... })
```

`cors: false` disables CORS headers entirely — no cross-origin
requests are permitted. Same-origin requests (the admin UI itself)
work regardless of CORS configuration.

## Prevention

For any HTTP service with cookie-based auth:

- Never pass `origin: undefined` to a CORS config with `credentials: true`
- Always fail closed when the allowlist is empty
- Test with an unlisted origin to verify rejection
