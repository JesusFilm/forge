---
title: Algolia public key vs server key — choosing correctly when integrating a sister project's index from a different domain
date: 2026-04-30
tags: [algolia, integration, api-keys, secrets, nextjs, server-actions]
category: integration-issues
severity: medium
---

## Problem

Project A (admin.jesusfilm.org) wants to query Project B's
(watch.jesusfilm.org's) Algolia index from server code. Both
projects have an Algolia integration with two env vars:

- `NEXT_PUBLIC_ALGOLIA_API_KEY` — the public key shipped to the
  browser
- `ALGOLIA_SERVER_API_KEY` — the server-only key

The naive integration uses `NEXT_PUBLIC_ALGOLIA_API_KEY` (since
that's the obvious "search from a browser" key) and gets a `403
{"message":"Method not allowed with this referer"}` from Algolia
when called from anywhere outside the source project's domain.

## Symptoms

```bash
$ curl -X POST "https://APPID-dsn.algolia.net/1/indexes/IDX/query" \
    -H "X-Algolia-API-Key: <NEXT_PUBLIC_ALGOLIA_API_KEY>" \
    -H "X-Algolia-Application-Id: APPID" \
    -d '{"query":"jesus"}'
{"message":"Method not allowed with this referer","status":403}
```

The error message is misleading — the request is in fact rejected
by an Algolia-side **referer allowlist** (and/or `validUntil` /
`restrictSources` API-key restrictions), not because the HTTP
method is wrong. Adding spoofed `Referer:` headers to match the
source domain works in some setups but is fragile and depends on
how the source project's key was provisioned.

## What Didn't Work

- **Setting `Referer: https://watch.jesusfilm.org/`** — sometimes
  works (if the public key only restricts referers, not source IPs),
  often doesn't if the key has tighter restrictions; brittle and
  trivially bypassed in either direction
- **Adding the new domain to the public key's allowlist** — requires
  Algolia console access on the source project, splits the security
  posture between two domains, and means rotating the public key
  affects both consumers
- **Using a different public key** — public keys ship to the browser,
  so any new key would also be public; doesn't change the security
  shape

## Solution

**Use the source project's `ALGOLIA_SERVER_API_KEY` from a
server-side proxy in the integrating project.** The server key has
no referer/origin restrictions — it's intended for backend code.
Browser code never sees it.

In Next.js, the cleanest shape is a Server Action:

```ts
// apps/admin/src/.../algolia-action.ts
"use server"

import { env } from "@/config/env"

export async function searchAlgolia(args: { q: string; limit: number }) {
  if (
    !env.ALGOLIA_APP_ID ||
    !env.ALGOLIA_SEARCH_API_KEY ||
    !env.ALGOLIA_INDEX
  ) {
    return { ok: false as const, code: "not_configured" }
  }
  const url = `https://${env.ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/${encodeURIComponent(env.ALGOLIA_INDEX)}/query`
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-Algolia-API-Key": env.ALGOLIA_SEARCH_API_KEY,
      "X-Algolia-Application-Id": env.ALGOLIA_APP_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: args.q, hitsPerPage: args.limit }),
    signal: AbortSignal.timeout(5000),
    cache: "no-store",
  })
  // ... handle response, return discriminated union
}
```

Env in admin's `.env`:

```
ALGOLIA_APP_ID=<from watch project>
ALGOLIA_SEARCH_API_KEY=<watch project's ALGOLIA_SERVER_API_KEY>
ALGOLIA_INDEX=<watch project's NEXT_PUBLIC_ALGOLIA_INDEX>
```

## Why This Works

Algolia API keys carry a server-side ACL bundle that includes:

- **Referer allowlist** (`validReferer`) — which domains may invoke
  this key from browser code
- **Index restrictions** (`indexes`) — which indexes the key may query
- **ACL** — read / write / settings / etc
- **Rate limits** (`maxQueriesPerIPPerHour`)

The "public" key is provisioned with a tight referer allowlist
(typically just the source domain) so it can ship to browsers
without being trivially abusable from anywhere on the internet.
The "server" key has no referer restriction — it's expected to be
used from server-side code where the request origin is implicitly
trusted (the server holds the secret).

Cross-domain integration via the public key is fundamentally
fighting the security model. Cross-domain integration via the
server key is fundamentally agreeing with it: the integrator's
server is now an extension of the source project's trust boundary.

## Caveats and gotchas

### 1. Confirm the "server key" is search-scoped, not admin-scoped

Algolia distinguishes "search-only" admin keys from full admin
keys. Both can sit in env as `ALGOLIA_SERVER_API_KEY`. A full admin
key has write/delete/settings ACL — exposing it via any future
server-side bug (a logged Authorization header, an SSRF, an
errant error message) widens the blast radius enormously.

**Verify with the source project's owner** which scope the key
carries. If it's admin-scoped, ask them to provision a
search-only key for cross-project consumers, OR provision your
own search-only key against the same App ID with a one-time
setup pass.

Algolia's API key creation flow makes this easy: from the
dashboard, "API Keys" → "New API Key" → set ACL to `search` only,
restrict to the specific index, no referer restriction.

### 2. API keys rotate

Server keys rotate. Public keys rotate. Cached values in your
local development workflow (env files, doppler-pulled `.env`
snapshots, hardcoded test fixtures) become invalid silently.

**Always re-pull from the canonical source at write time** —
not from cached chat history, not from a `.env.local` last
synced last week, not from a teammate's screenshare. For
Doppler-managed envs:

```bash
doppler secrets get ALGOLIA_SERVER_API_KEY \
  --project <source-project> \
  --config <env> --plain
```

For Railway, write through the MCP / dashboard with the freshly
pulled value.

### 3. Verify the key works against the actual endpoint before deploying

Before pushing the key to Railway / Doppler:

```bash
KEY=$(doppler secrets get ALGOLIA_SERVER_API_KEY --project watch --config stg --plain)
curl -s -X POST "https://APPID-dsn.algolia.net/1/indexes/IDX/query" \
  -H "X-Algolia-API-Key: $KEY" \
  -H "X-Algolia-Application-Id: APPID" \
  -d '{"query":"test","hitsPerPage":1}' | head -c 200
```

A non-403 response confirms the key is live. Skipping this step
costs ~10-20 minutes per failed deploy cycle while you debug a
key-mismatch in production.

### 4. Server-action surface vs new public REST route

Prefer Server Actions over `/api/algolia-search` route handlers
when the consumer is your own UI. Server Actions:

- Don't create an addressable URL contract
- Don't need rate-limit infrastructure (framework-internal)
- Disappear cleanly when the calling component is removed (relevant
  for migration-era harnesses, see related lesson)

If the consumer is a different app, a REST endpoint is fine — but
add the rate-limit middleware up front.

### 5. Server-action error redaction

Server Action thrown errors are **redacted in production builds**
(see related lesson). If your action signals "not configured" via
`throw new Error("not_configured")`, the client will not be able
to distinguish that from a generic upstream error in prod. Use a
discriminated-union return shape from day one.

## Prevention

1. **First Algolia integration in the codebase**: document the
   server-key vs public-key choice in the integration's README or
   inline comments. Future integrations crib from it.
2. **Pre-deploy curl probe**: include a one-line curl against the
   target endpoint with the key being deployed. Catches stale
   values and ACL mismatches before they reach prod.
3. **Verify scope**: when accepting a key handoff from another
   team, ask explicitly "is this search-only or admin-scoped?"
   Don't assume.
4. **Don't cache keys across session boundaries**: chat history,
   shell environment vars, sticky tabs — re-pull at the moment of
   write.

## Where this bit us

PR #864 (admin Algolia parity column on `/watch/demo-keyword-search`,
merged 2026-04-30):

- **Initial discovery**: tried `NEXT_PUBLIC_ALGOLIA_API_KEY` from
  watch's stg config, hit `403 "Method not allowed with this
referer"` from `admin.jesusfilm.org`. Verified by curl with
  multiple `Referer:` values — none worked.
- **Resolution**: switched to watch's `ALGOLIA_SERVER_API_KEY` →
  immediately worked. Verified with curl returning BibleProject hits.
- **Caching trap**: pulled the key value early in the session,
  pushed to Railway via MCP an hour later. By that time the key had
  rotated. Container deploy succeeded but Algolia returned 403
  "Invalid Application-ID or API key". Cost: 4 deploy cycles + ~45
  min before re-pulling from Doppler at the time of the Railway
  write.
- **Scope check**: the watch team's `ALGOLIA_SERVER_API_KEY` is
  documented as "unrestricted" — needs follow-up confirmation that
  it's search-scoped, not admin-scoped, before going beyond a
  throwaway harness.

## Related

- [Algolia API key documentation](https://www.algolia.com/doc/guides/security/api-keys/)
- `docs/solutions/best-practices/nextjs-server-action-error-redaction-prod-20260430.md`
  — sibling lesson on Server Action failure-mode signaling
- `docs/solutions/best-practices/throwaway-operator-harness-deletion-contract-20260430.md`
  — sibling lesson on migration-era tooling lifetime
- `docs/solutions/platform/railway-mcp-staged-config-never-commits-20260420.md`
  (env-var values variant) — the deployment-side trap that compounded
  the key-rotation issue in PR #864
- `apps/admin/src/app/watch/demo-keyword-search/algolia-action.ts`
  — the concrete server-action implementation (throwaway, slated
  for R8 retirement)
