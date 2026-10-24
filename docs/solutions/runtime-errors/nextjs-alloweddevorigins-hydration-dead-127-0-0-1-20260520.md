---
title: Next.js 16 dev blocks page-wide hydration when apps/web is loaded from 127.0.0.1 — `allowedDevOrigins` fix
date: 2026-05-20
last_updated: 2026-07-31
category: docs/solutions/runtime-errors
module: apps/web
problem_type: runtime_error
component: development_workflow
severity: high
symptoms:
  - "React never calls hydrateRoot below body — zero fiber keys on any descendant, no useEffect runs, no event handlers wire up"
  - "Page renders SSR HTML correctly and the React-DOM DevTools install-prompt logs in console, but every interactive control is dead"
  - "No actionable error in the browser console, dev error overlay, or Next.js error portal — silent failure"
  - "Only signal is a single warning line in `next dev` stdout naming allowedDevOrigins as the fix"
  - "Only reproducible when the page is loaded from 127.0.0.1 while the dev server's canonical host is localhost"
root_cause: config_error
resolution_type: config_change
related_components:
  - apps/admin
  - apps/web/next.config.mjs
tags:
  - nextjs
  - hydration
  - 127-0-0-1
  - alloweddevorigins
  - dev-mode
  - cross-origin
  - apps-web
  - tailscale
---

# Next.js 16 dev blocks page-wide hydration when apps/web is loaded from 127.0.0.1 — `allowedDevOrigins` fix

## Problem

Next.js 16's dev server applies a same-origin guard to dev-only resources (`/_next/webpack-hmr`, client chunk manifests, RSC payloads). When the browser's `Origin` header doesn't match the dev server's canonical hostname (`localhost`), Next.js blocks those fetches. With the HMR socket and client chunks blocked, React-DOM loads but `hydrateRoot` is never called for the subtree below `<body>` — the page renders SSR HTML correctly and every interactive element is dead.

The only diagnostic signal is a warning line in `next dev` **stdout** — not in the browser console, not in the dev error overlay.

## Symptoms

- Page renders SSR HTML correctly — content visible, no 404, no 500.
- React DevTools install-prompt appears in browser console (react-dom loaded fine).
- `document.body` has `__reactFiber$*` and `__reactProps$*` keys (React root attached to the body).
- `document.querySelector('main')` and every interactive descendant have **no** React fiber keys.
- Probing all `<button>` elements returns 0 hydrated.
- `window.__next_f.length` is 0.
- video.js / Mux Player elements mount as empty placeholders — their `useEffect` never runs to attach an HLS source.
- Accordions don't toggle. Carousels don't scroll. Quiz buttons don't open overlays. The page is inert HTML.
- React logs **no** hydration mismatch error. It silently aborts.

## What Didn't Work

The misdiagnosis chain consumed roughly two hours and five false-positive fixes before the actual cause surfaced:

1. **Suspected SSR/CSR drift in `EasterDates` (`new Date()` during render).** There was a real hydration-mismatch bug at that location and fixing it was worthwhile, but it did not restore hydration on the rest of the page. Two separate bugs; one distracted from the other.
2. **Suspected `BibleQuotesCarousel` missing-key React warnings.** Non-blocking warnings, red herring.
3. **Suspected `SectionBlock` dispatch problem in `MediaCollection.tsx`.** Chased component-level logic while the failure was infrastructure-level.
4. **Suspected project-wide React-bootstrap failure.** Correct symptom description, wrong cause. Checked `/watch` and saw the same 0/N hydration — falsely concluded the diff itself broke React globally, rather than narrowing to the host mismatch.
5. **Suspected Turbopack cache corruption.** Cleared `apps/web/.next` and restarted `next dev`. No fix.
6. **Suspected wedged admin GraphQL state.** Admin was wedged from a prior session (real but separate issue) and was investigated as a potential cause — it had no effect on the hydration block.

**Prior incident on the apps/admin side (session history).** This is not the first time the host mismatch caused a silent failure. On 2026-05-13, the same `127.0.0.1` host preference caused a **credential leak** on `apps/admin`:

- User accessed admin at `http://127.0.0.1:3003` to bypass admin's auth-host proxy that 404s `/api/*` and loops `/dashboard` when accessed via `localhost`.
- Next.js dev-origin guard blocked the JavaScript bundle from loading on the login page.
- With no JS attached, the login form fell back to its HTML default — a `GET` submission.
- The credentials appeared URL-encoded in admin's stdout in the next log line.

`allowedDevOrigins` was applied to `apps/admin/next.config.ts` during that incident and then **reverted** after the team clarified that admin's actual login entrypoint is `apps/auth` at port 3004 in OAuth mode (where `allowedDevOrigins` isn't load-bearing because OAuth callbacks aren't cross-origin to admin). The conclusion at the time was correct for admin but **left the apps/web side of the same root host preference unaddressed** — `apps/web` was always opened at `localhost:3000` in the sessions that followed, so the apps/web hydration failure mode never surfaced until today.

## Solution

One line in `apps/web/next.config.mjs`, followed by a `next dev` restart:

```js
// Before
const nextConfig = {
  basePath: "/watch",
  experimental: { typedRoutes: true },
  images: {
    /* ... */
  },
}

// After
const nextConfig = {
  basePath: "/watch",
  allowedDevOrigins: ["127.0.0.1"], // dev-only; production builds ignore this
  experimental: { typedRoutes: true },
  images: {
    /* ... */
  },
}
```

After restart, hydration completes on the first reload. (A dev-panel click is occasionally needed to kick the RSC streaming pipeline — separate quirk, unrelated to this fix.)

Production builds strip `allowedDevOrigins` entirely. The field is a dev-only escape hatch.

### HTTPS reverse-proxy follow-up

Remote QA through Tailscale Serve adds a second origin shape: the browser uses
the public HTTPS hostname while `next dev` still listens on HTTP loopback. The
current configuration derives the extra development hostname from the public
origin passed to that child process, while retaining the original loopback
allowance:

```js
export function getAllowedDevOrigins(canonicalOrigin) {
  const origins = new Set(["127.0.0.1"])
  if (!canonicalOrigin) return [...origins]

  try {
    origins.add(new globalThis.URL(canonicalOrigin).hostname)
  } catch {
    // The optional override must not prevent local development from starting.
  }

  return [...origins]
}
```

`apps/web/next.config.mjs:48-68` passes the hostname-only result to
`allowedDevOrigins`; it does not admit a wildcard or hardcode a machine or
tailnet address. `apps/web/scripts/next-config.test.mjs:13-23` covers the
configured hostname and malformed-input fallback.

The rewrite handles reverse-proxy requests whose `request.nextUrl` has an HTTPS
scheme and a loopback hostname. An internal Watch locale rewrite clones that URL, so the
rewrite would otherwise attempt TLS against the HTTP-only local listener. The
rewrite path therefore normalizes only non-production `localhost` and
`127.0.0.1` targets back to HTTP:

```ts
const url = request.nextUrl.clone()
if (
  process.env.NODE_ENV !== "production" &&
  (url.hostname === "localhost" || url.hostname === "127.0.0.1")
) {
  url.protocol = "http:"
}
url.pathname = internalRewritePathname(decision)
```

The guard is deliberately narrower than all development rewrites.
`apps/web/src/proxy.test.ts:375-414` proves that development loopback rewrites
use HTTP, external development rewrites stay on HTTPS, and production
loopback-shaped rewrites stay on HTTPS.

## Why This Works

Next.js 16 introduced a same-origin guard on dev-only resource paths. When the request's `Origin` header doesn't match `http://localhost:<port>`, the framework refuses to serve `/_next/webpack-hmr` and the client chunk manifest. Without those, React-DOM loads but cannot complete RSC hydration — `hydrateRoot` is never called for the subtree below the root `<body>`. The app shell gets a React root; every component tree below it is inert SSR HTML.

`allowedDevOrigins: ['127.0.0.1']` extends the allowed origins set to include the IP variant. The browser's `Origin: http://127.0.0.1:3000` now matches and the framework serves the dev resources normally.

The `127.0.0.1` host preference exists in this monorepo specifically because `apps/admin`'s auth-host proxy treats `localhost` as the auth-host and loops `/dashboard` redirects when admin is accessed via `localhost:3003`. The IP variant short-circuits the loop. Browser tabs that follow links from admin to apps/web inherit `127.0.0.1` as the host; apps/web's `basePath: "/watch"` shares that host, so `/watch/easter` loads from `127.0.0.1:3000` and the block fires.

`apps/web/.env.local` already uses `ADMIN_GRAPHQL_URL=http://127.0.0.1:3003/api/graphql` for the server-side GraphQL client, so the `127.0.0.1` host preference is part of the documented dev convention. The hydration block is the side of that preference that hadn't surfaced because nobody had previously opened apps/web at the IP address.

For the HTTPS reverse-proxy case, two boundaries must agree without being
collapsed. `NEXT_PUBLIC_CANONICAL_ORIGIN` identifies the browser-facing host
that Next may serve in development, while the cloned loopback rewrite URL must
match the HTTP listener used by the child process. Keeping the protocol change
inside the non-production loopback branch preserves public HTTPS URLs and the
existing locale/htmlLang pathname mapping.

## Prevention

- **Check `next dev` stdout first** when debugging "page renders but nothing is interactive" symptoms in Next.js 16+ dev. The actionable warnings live there — the browser-side signal is absent.

- **The verbatim warning to grep for** in dev-server stdout:

  ```
  ⚠ Blocked cross-origin request to Next.js dev resource /watch/_next/webpack-hmr from "127.0.0.1".
  Cross-origin access to Next.js dev resources is blocked by default for safety.

  To allow this host in development, add it to "allowedDevOrigins" in next.config.js and restart the dev server:

    module.exports = { allowedDevOrigins: ['127.0.0.1'] }

  Read more: https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins
  ```

- **Diagnostic shortcut** — capture dev-server stdout to a log so the warning persists across navigations:

  ```bash
  pnpm --filter @forge/web dev 2>&1 | tee /tmp/web-dev.log
  # In another terminal:
  grep -iE "blocked cross-origin|allowedDevOrigins" /tmp/web-dev.log
  ```

- **`allowedDevOrigins` is dev-only.** Production builds ignore it. Adding it prophylactically to any Next.js app in this monorepo that developers may access via `127.0.0.1` has zero production impact.

- **Exercise one client control through the public HTTPS endpoint.** A remote
  smoke test should open and close Search, inspect browser errors, and scan the
  web stderr log for `Blocked cross-origin request`. A loopback HTTP 200 alone
  does not prove remote hydration or rewrite transport.

- **Keep the rewrite protocol controls together.** Test development loopback,
  external development, and production loopback cases whenever the internal
  Watch rewrite changes. This prevents a local proxy fix from weakening public
  HTTPS behavior.

- **`apps/admin` deliberately does NOT use this fix.** Per the related doc below, admin's auth-host proxy collides with the same setting in unsafe ways; admin's mitigation is to keep CLI workflows (no browser interaction) at `127.0.0.1` and access admin through `apps/auth` at port 3004 in OAuth mode. Do not copy this fix to `apps/admin/next.config.ts`.

## Related Issues

- [`docs/solutions/performance-issues/watch-static-locale-rewrite-route-manifest-admission-20260529.md`](../performance-issues/watch-static-locale-rewrite-route-manifest-admission-20260529.md) documents the route-admission and locale/htmlLang rewrite contract that the development-only protocol normalization must preserve.

- [`docs/solutions/developer-experience/local-admin-dev-auth-flow-impractical-20260514.md`](../developer-experience/local-admin-dev-auth-flow-impractical-20260514.md) — Counterpart on the apps/admin side. Same dev-origin guard mechanism, same `127.0.0.1` host preference, **opposite resolution**: admin must NOT use `allowedDevOrigins` because of an auth-proxy collision. This doc and that one should be read together — applying the wrong half's fix to the other app reintroduces the problem.

- Auto-memory `feedback_admin_localhost_127_workaround.md` (session history) — documents the `127.0.0.1` host preference for apps/admin and the auth-proxy reason behind it. The framing in that note was hardened after the credential-leak incident on 2026-05-13 to remove the original "safe workaround" language.

- PR [#984](https://github.com/JesusFilm/forge/pull/984) — the four-fix PR that shipped this `next.config.mjs` change plus three collateral apps/web fixes (`EasterDates` hydration deferral, `enrichment.ts` empty-string handling, MediaCollection URL rewrite). 533/535 vitest, typecheck/lint clean, CI green.
