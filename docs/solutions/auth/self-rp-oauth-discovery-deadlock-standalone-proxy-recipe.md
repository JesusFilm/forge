---
title: "Self-RP OAuth discovery deadlock: verify auth locally with a standalone build behind a static-discovery proxy"
date: 2026-09-07
category: auth
module: apps/auth
problem_type: developer_experience
component: authentication
severity: medium
applies_when:
  - "Locally verifying apps/auth's Better Auth generic-oauth self-RP flow (the jfp provider mobile signs in through)"
  - "next dev or the bare standalone server hangs with no error while apps/auth is the OAuth client of its own oauth-provider"
  - "A @better-auth/expo bump turned the vendor drift guard red and the mirrored proxy needs re-verification"
  - "BETTER_AUTH_SECRET changed locally and stored jwks rows now belong to a different signing key"
symptoms:
  - "The first auth-touching request never answers and logs no error once the generic-oauth provider's discoveryUrl points at the same auth instance"
  - "The discovery route handler awaits the same initializing auth instance that is fetching it"
related_components:
  - development_workflow
  - tooling
tags:
  - auth
  - oauth
  - self-rp
  - better-auth
  - discovery
  - local-dev
  - standalone-build
  - mobile
---

# Self-RP OAuth discovery deadlock: verify auth locally with a standalone build behind a static-discovery proxy

## Context

apps/auth is the OAuth CLIENT of its own oauth-provider. The `jfp` generic-oauth
provider that apps/mobile signs in through is `jfpMobileSelfProvider`
(`apps/auth/src/auth/config.ts:170-183`). Its discovery URL points at the app's
own origin: `discoveryUrl: ${getAuthBaseUrl()}/.well-known/openid-configuration`
(`apps/auth/src/auth/config.ts:172`).

The route that serves that URL imports the same `auth` instance
(`apps/auth/src/app/.well-known/openid-configuration/route.ts:3-5`). At init,
the auth instance fetches its own discovery URL. The route awaits the same
initializing instance. This is a circular await: the first request that touches
auth hangs with no logged error. The gitignored local ticket
`todos/026-pending-p1-auth-self-rp-discovery-deadlock-at-cold-start.md` records
that the deadlock reproduces in BOTH `next dev` and the standalone production
build run bare — which is why this doc, not the ticket, must carry the recipe.

Three approaches failed before the recipe below:

- `next dev` — hangs as above.
- The bare standalone server (`next build && next start`) — the discovery
  handler still awaits the same initializing instance (todos/026's record).
- Keeping the recipe only as scripts in `/tmp`. The OS purged them between
  sessions (observed 2026-09-07), and the recipe had to be reconstructed. This
  doc exists so that reconstruction never repeats.

## Guidance

The recipe runs the production-shaped standalone server on :3005 and a small
proxy on :3004. The proxy answers the discovery URL from a static file and
forwards everything else. The app's init-time discovery fetch is answered
without touching the app, which breaks the circular await.

### 1. Build the standalone output

```bash
cd apps/auth
pnpm build
```

This is the same standalone shape production runs: `railway.toml` builds with
`pnpm --filter @forge/auth build` plus a static-asset copy
(`apps/auth/railway.toml:27`) and starts
`node apps/auth/.next/standalone/apps/auth/server.js` with `HOSTNAME=0.0.0.0`
(`apps/auth/railway.toml:30`).

### 2. Copy the assets Next leaves out of standalone

```bash
# Plain checkout:
STANDALONE=.next/standalone
# Git worktree under .claude/worktrees/<name>: Next's file tracing root is
# the main checkout, so the server lands at a NESTED path instead:
STANDALONE=.next/standalone/.claude/worktrees/<name>

cp -r .next/static "$STANDALONE/apps/auth/.next/static"
cp -r public "$STANDALONE/apps/auth/public"
```

### 3. Start the server on :3005

Export env from `.env` (Doppler `forge-auth` dev) and `.env.local` (local
`DATABASE_URL`), then run the standalone server:

```bash
set -a
source .env
source .env.local
set +a
NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3005 \
  node "$STANDALONE/apps/auth/server.js"
```

### 4. Derive the static discovery document from production

Do not hand-write the JSON. Derive it from what the provider actually serves,
so the document shape stays exact:

```bash
curl -s https://auth.jesusfilm.org/.well-known/openid-configuration \
  | sed 's|https://auth.jesusfilm.org|http://localhost:3004|g' \
  > local-discovery.json
```

The resulting issuer is `http://localhost:3004/api/auth`.

### 5. Run the static-discovery proxy on :3004

```js
// local-auth-proxy.mjs — static-discovery proxy: answers
// /.well-known/openid-configuration itself so the app's init-time self-RP
// discovery fetch cannot deadlock; forwards everything else :3004 -> :3005.
import { createServer, request as httpRequest } from "node:http"
import { readFileSync } from "node:fs"

const DISCOVERY = readFileSync(
  new URL("./local-discovery.json", import.meta.url),
)

const server = createServer((req, res) => {
  if (req.url === "/.well-known/openid-configuration") {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(DISCOVERY)
    return
  }
  const upstream = httpRequest(
    {
      host: "127.0.0.1",
      port: 3005,
      method: req.method,
      path: req.url,
      headers: req.headers,
    },
    (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, upRes.headers)
      upRes.pipe(res)
    },
  )
  upstream.on("error", (error) => {
    res.writeHead(502)
    res.end(`proxy error: ${String(error)}`)
  })
  req.pipe(upstream)
})

server.listen(3004)
```

```bash
node local-auth-proxy.mjs
```

### 6. Prepare the local database (`forge_auth`)

The production-mode standalone resolves the PRODUCTION self-RP client id: the
`NODE_ENV === "production"` conditional at `apps/auth/src/auth/config.ts:165-168`
selects `MOBILE_PRODUCTION_CLIENT_ID`, which is `"jfp_mobile_production"`
(`apps/auth/src/domain/apps.ts:23`). Two writes are needed:

- Append `http://localhost:3004/api/auth/callback/jfp` to the `redirectUris` of
  the local `jfp_mobile_production` OAuth client row.
- If `BETTER_AUTH_SECRET` differs from a previous run, delete the stale `jwks`
  rows. Otherwise token signing fails.

### 7. Verify with curl probes that replay the Expo client's hops

```bash
# Hop 1 — sign-in. Expect 200 with an authorize URL in the body.
curl -si http://localhost:3004/api/auth/sign-in/social \
  -H 'content-type: application/json' \
  -H 'expo-origin: forgemobile://' \
  -H 'x-skip-oauth-proxy: true' \
  -d '{"provider":"jfp","callbackURL":"forgemobile:///"}'

# Hop 2 — browser proxy. Expect 302 plus a signed better-auth.state cookie.
curl -si 'http://localhost:3004/api/auth/expo-authorization-proxy?authorizationURL=<url-encoded authorize URL from hop 1>'

# Hop 3 — callback with a bogus code and the state cookie.
# Expect: 302 forgemobile:///?error=invalid_code
curl -si 'http://localhost:3004/api/auth/callback/jfp?state=<state>&code=bogus' \
  -H 'cookie: better-auth.state=<cookie value from hop 2>'

# Negative control — a same-origin /callback/google URL through the proxy.
# Expect: 400.
```

## Why This Matters

The vendor drift guard `apps/auth/src/auth/mobile-expo-plugin.guard.test.ts`
pins `@better-auth/expo` to an exact version AND a SHA-256 of the installed
dist file. Its own comment says why: a bump must fail HERE and force a re-diff
of the hand-mirrored proxy in `mobile-expo-plugin.ts`. So the guard fails on
EVERY future `@better-auth/expo` bump, by design.

Re-verifying the mirrored proxy after a bump needs exactly this local
end-to-end run. Without this doc, each bump repeats the deadlock re-diagnosis
plus the recipe reconstruction that the purged `/tmp` scripts already forced
once.

## When to Apply

- Any `@better-auth/expo` bump. The drift guard goes red, and the mirror in
  `mobile-expo-plugin.ts` must be re-verified against the new dist.
- Any change to `mobile-expo-plugin.ts`, to `jfpMobileSelfProvider`, or to the
  hosted sign-in chain (feat-349).
- Any task that needs a local end-to-end mobile sign-in against apps/auth,
  including a real browser login through the simulator sheet.
- Do not use `next dev` or a bare `next start` for any of the above. Neither
  can serve the first auth-touching request.

## Examples

- 2026-08-28/29: the recipe verified the full sign-in chain, including a real
  browser login through the simulator sheet.
- 2026-09-07: the recipe was reconstructed and re-verified on the tree that
  became PR #2176 (the curl probes in step 7 are the re-verified set).
- The proxy source in step 5 is the reconstructed, verified copy — keep it in
  this doc, not in `/tmp`.

## Related

- `docs/solutions/integration-issues/better-auth-1-7-upgrade-broke-mobile-self-rp-sign-in.md`
  — the incident whose verification used this recipe; its Verification section
  names the proxy without documenting it.
- `todos/026-pending-p1-auth-self-rp-discovery-deadlock-at-cold-start.md`
  (gitignored, local only) — the origin ticket; its production-side fix (serve
  discovery without awaiting init, or add a startup probe) remains open.
- `docs/solutions/best-practices/nextjs-hmr-reload-breaks-stateful-browser-verification.md`
  — the general rule that `next dev` is the wrong substrate for a class of
  verification; this doc is another instance with a different mechanism.
