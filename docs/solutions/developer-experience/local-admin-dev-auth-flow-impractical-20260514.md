---
module: apps/admin
date: "2026-05-14"
problem_type: developer_experience
component: authentication
severity: medium
applies_when:
  - "Working on apps/admin UI locally and needing /dashboard or /api/* to load"
  - "Considering the 127.0.0.1:3003 workaround to bypass admin's proxy origin check"
  - "Running admin in ADMIN_AUTH_MODE=oauth against a local apps/auth at :3004"
  - "Choosing between local admin UI vs CLI workflows (pnpm run-sync, run-experience-dump, run-embeds) for dev tasks"
  - "Onboarding a new dev to the admin app and tempted to make localhost work"
symptoms:
  - "/dashboard redirect-loops because proxy treats localhost:3003 as both auth-host and admin-host"
  - "/api/* returns 404 in dev for the same proxy host-collision reason"
  - "127.0.0.1:3003 workaround trips Next.js dev-origin guard, blocking the JS bundle"
  - "Login form falls back to GET method, leaking email+password into URL, history, and server stdout"
  - "Even after successful apps/auth login, post-login /dashboard redirect still loops"
related_components:
  - development_workflow
  - tooling
tags:
  - admin
  - local-dev
  - auth-proxy
  - oauth
  - next-dev-origin
  - credential-leak
  - cli-workflows
  - consumer-migration
---

# Local admin web UI is impractical for dev work — use CLI bypasses or the prod gate

## Context

Local development against `apps/admin`'s web UI ran into three stacked failures during the consumer-migration debug arc. None is independently easy to fix; together they make the local UI unusable as a development surface.

1. **`/dashboard` infinite-redirect-loops at admin's proxy.** Local config sets `BETTER_AUTH_URL` and the first entry of `AUTH_TRUSTED_ORIGINS` both to `http://localhost:3003`. The proxy reads each via `getAuthBaseURL()` and `getDefaultPostLoginURL()`, so auth-host and admin-host resolve to the same string. The "redirect this auth-host page back to admin" branch rewrites the URL to the same origin and the browser loops.

2. **`/api/*` returns 404 in dev** because of the same collision — anything under `/api/` that isn't `/api/auth` hits the proxy's `pathname.startsWith("/api/")` branch and is short-circuited to a 404 response while the proxy still believes it is on the auth host. This is what the U5 smoke discovered earlier in the migration (per the project's running notes).

3. **The "use 127.0.0.1 to bypass it" workaround triggers Next.js's dev-origin guard.** Next blocks `/_next/webpack-hmr` and the JS bundle as a cross-origin dev resource. The login form's React handler never mounts, the `<form>` falls back to default HTML form submission (GET, empty action), and **the email + password land in the URL as query params** — written to browser history AND admin server logs.

OAuth mode (`ADMIN_AUTH_MODE=oauth` + `apps/auth` on port 3004) compounds this: even when login at apps/auth succeeds, the post-login redirect to `http://localhost:3003/dashboard` still hits the same proxy loop. There is no clean local UI path.

The earlier auto-memory entry `feedback_admin_localhost_127_workaround.md` framed 127.0.0.1 as a safe workaround. **It is not.** This document supersedes that framing.

## Why This Matters

> **Security-relevant.** The 127.0.0.1 workaround leaks credentials into your URL bar, your browser history, and the admin Next.js server log. Anyone with shell access to your machine — or a screen recording of your dev session — can read your password. This is not a cosmetic issue.

The three failure modes have **different root causes** and none is independently easy to fix:

- The proxy loop is structural — `getAuthBaseURL()` and `getDefaultPostLoginURL()` resolve to the same origin locally by design (auth-host and admin-host co-located on `localhost:3003`).
- The Next dev-origin guard is intentional — relaxing it via `allowedDevOrigins` diverges local config from production and the divergence has to be maintained per-engineer.
- OAuth mode in dev requires running `apps/auth` on `:3004`, seeding first-party app registrations, and threading callback URLs that still loop at admin's proxy.

Patching any one of these creates a local-only code path that drifts from prod. The pragmatic answer is to **stop using the local admin UI for dev work**, not to patch the workaround. The CLI bypasses (covered below) are not just a "nice-to-have local optimization" — they are the only viable Tier A path for admin development today. The existing `local-embed-pipeline-pattern-20260429.md` doc names "round-tripping through Railway, Cloudflare's 524 edge timeout, and admin's ADMIN-session gate" as the motivation for CLI workflows; this doc completes that motivation by documenting that the local web UI is ALSO not a viable iteration loop.

## Guidance

### Do not try to fix the local admin UI

- Do not add `127.0.0.1` to `AUTH_TRUSTED_ORIGINS` and stop there — the JS bundle still won't load without an `allowedDevOrigins` patch to `next.config.ts`, and the resulting config diverges from prod.
- Do not patch `redirectAuthPageToAdmin()` to detect the same-origin case — that masks the actual bug for prod (where `auth.jesusfilm.org` and `admin.jesusfilm.org` are genuinely distinct) and the prod path is exercised by every production deploy.
- Treat any "local-only auth shim" PR as a smell. The cost of maintaining a parallel local auth path is higher than the cost of running real workflows via CLI.

### Use CLI workflows that bypass auth entirely

For day-to-day dev — sync, embeddings, dumps, search-eval — invoke the in-process scripts that run against `DATABASE_URL` directly. They share the same service code the GraphQL mutations call, so behaviour parity is preserved without going through the browser:

```bash
pnpm --filter @forge/admin run-sync
pnpm --filter @forge/admin run-experience-dump
pnpm --filter @forge/admin run-embeds --pipeline=both
pnpm --filter @forge/admin trigger-enrichment --from-report=<path> --kind=scene-analysis
pnpm --filter @forge/admin eval:search:quick
```

`run-sync.ts`-shape scripts gate only on `DATABASE_URL` — point them at your local `forge_admin` DB and they don't touch the auth surface at all.

### Trust the prod gate when you need the real UI

When you actually need the admin UI (rare — usually only for visual QA of editor flows), point a local harness at `https://admin.jesusfilm.org` via `ADMIN_GRAPHQL_URL` or `ADMIN_BASE_URL` and log in there. Production has distinct origins for auth and admin, so the proxy loop doesn't exist and the dev-origin guard doesn't apply.

## When to Apply

- Anytime you catch yourself reaching for the 127.0.0.1 trick on `http://localhost:3003`.
- Setting up a new dev machine where the local admin UI "should just work" and doesn't.
- Onboarding a new engineer who tries to log in locally and sees the redirect loop.
- Triaging a Slack message that includes a local admin URL with `?email=...&password=...` query params — rotate the leaked credential immediately and link them to this doc.

## Examples

### Failure-mode 1 — the proxy loop

`apps/admin/src/proxy.ts:62-83` is the offending path. `getRequestOrigin()` returns `http://localhost:3003`; `getAuthBaseURL()` returns the same string from `apps/admin/src/auth/origins.ts:21-23`; `redirectAuthPageToAdmin()` at lines 54-60 rewrites:

```ts
function redirectAuthPageToAdmin(request: NextRequest) {
  const adminURL = new URL(getDefaultPostLoginURL())
  adminURL.pathname = request.nextUrl.pathname
  adminURL.search = request.nextUrl.search
  return NextResponse.redirect(adminURL)
}
```

`getDefaultPostLoginURL()` at `origins.ts:42-45` reads `AUTH_TRUSTED_ORIGINS` first entry — locally that is `http://localhost:3003`, so `new URL(...)` plus `.pathname = request.nextUrl.pathname` produces the same URL the browser just sent. Infinite 307 loop.

### Failure-mode 2 — credential leak via HTML form fallback

`apps/admin/src/app/login/login-page-client.tsx:40-58` calls `e.preventDefault()` and fetches `/api/auth/sign-in/email` as JSON:

```tsx
async function handleSubmit(e: FormEvent<HTMLFormElement>) {
  e.preventDefault()
  // ...
  const res = await fetch(`${authApiBase}/sign-in/email`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: form.get("email"),
      password: form.get("password"),
      callbackURL: resolvedCallbackURL,
    }),
  })
```

When the React bundle never loads (the Next dev-origin guard blocks `/_next/webpack-hmr` from `127.0.0.1`), the `<form onSubmit={handleSubmit}>` has no handler attached. The browser's default form submission is `method="GET"` against `action=""` (current URL), so submitting writes:

```
http://127.0.0.1:3003/login?email=urim@jesusfilm.org&password=<plaintext>&callbackURL=...
```

That URL hits the admin Next dev server's request log AND the browser's history. Both have to be wiped, and the password has to be rotated.

The warning that surfaces in the admin terminal is:

> Blocked cross-origin request to Next.js dev resource /\_next/webpack-hmr from "127.0.0.1". Cross-origin access to Next.js dev resources is blocked by default for safety. To allow this host in development, add it to "allowedDevOrigins" in next.config.js and restart the dev server.

If you see this, **stop and assume credentials already leaked.** Don't try the form again.

### Failure-mode 3 — OAuth completion still loops

When `ADMIN_AUTH_MODE=oauth`, hitting any admin path redirects through `apps/auth` at `localhost:3004`. The OAuth round-trip succeeds (apps/auth verifies credentials, admin's `/api/auth/callback` exchanges the code, admin sets a session cookie), then redirects to `localhost:3003/dashboard`. That final hop hits the proxy loop from failure-mode 1 — fresh cookies, valid session, infinite redirect. The OAuth flow is correctly wired; the proxy is what breaks the experience.

### The actual answer — CLI bypass

```bash
DATABASE_URL='postgresql://forge:forge@127.0.0.1:5432/forge_admin' \
pnpm --filter @forge/admin run-embeds --pipeline=transcript
```

No auth. No proxy. No browser. Same service code the GraphQL mutation would call.

For one-off admin GraphQL queries from a script, mint a bearer principal via `WORKFLOW_API_KEYS` (see admin CLAUDE.md "Triggering embeds from manager") and POST to the GraphQL endpoint with `Authorization: Bearer <key>` — never via the browser-flow login.

## Related

- [`docs/solutions/auth/admin-sso-uses-oauth-local-session-not-shared-cookies.md`](../auth/admin-sso-uses-oauth-local-session-not-shared-cookies.md) — Production OAuth wiring + smoke-test chain. The chain documented there does NOT work cleanly on `localhost:3003` or `127.0.0.1:3003` in dev for the reasons captured here; follow it only against the deployed admin host.
- [`docs/solutions/platform/local-embed-pipeline-pattern-20260429.md`](../platform/local-embed-pipeline-pattern-20260429.md) — The positive alternative: `pnpm run-embeds`, `pnpm run-sync`, direct-invoke CLI shape. This doc's "use CLI, not web UI" resolution depends on that pattern existing.
- [`docs/solutions/developer-experience/env-matrix-drift-from-runtime-requirements-20260421.md`](./env-matrix-drift-from-runtime-requirements-20260421.md) — Adjacent shape: routes look healthy but a deeper path 500s. Same "the admin looks broken when the server is fine" disorientation pattern.
- [`docs/solutions/architecture-patterns/parity-bearer-narrow-carveout-pattern-20260513.md`](../architecture-patterns/parity-bearer-narrow-carveout-pattern-20260513.md) and [`consumer-bearer-rate-limit-identity-pattern-20260513.md`](../architecture-patterns/consumer-bearer-rate-limit-identity-pattern-20260513.md) — The prod-gate surfaces (parity harness, web SSR) that this doc says to trust instead of local Tier A.
