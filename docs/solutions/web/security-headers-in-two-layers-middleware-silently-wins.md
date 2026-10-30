---
title: "Security headers set in two layers: middleware silently wins, which turns a future flag flip into a no-op"
date: "2026-09-22"
category: "web"
module: "apps/web next.config headers() + src/proxy.ts"
problem_type: "logic-error"
component: "security_headers"
severity: "high"
applies_when:
  - "Setting the same response header in both next.config.mjs headers() and middleware/proxy"
  - "Introducing a report-only security policy meant to be promoted to enforced later"
  - "Moving a header set from middleware to config, or the reverse"
tags: [nextjs, csp, security-headers, middleware, proxy, feature-flag, rollout]
related_components: [apps/web]
---

# Security headers in two layers: middleware silently wins

## Context

FGE-235 moved Watch's baseline security headers into `next.config.mjs` `headers()`
on `/:path*`, because `applyWatchSecurityHeaders` in `src/proxy.ts` only ran on the
two rewrite call sites and so never covered the basePath root `/watch`.

The middleware copy was deliberately left in place as defense-in-depth, justified
by a measurement: on a rewritten route exactly **one** `Content-Security-Policy`
and one `Referrer-Policy` came back, so "nothing is duplicated."

That measurement was correct and the conclusion drawn from it was wrong.

## The mechanism

Next evaluates config `headers()` **before** middleware and merges middleware's
headers over them with a plain last-write-wins assignment
(`resHeaders[key] = value` in `resolve-routes.js`). So for any key both layers
write, **middleware's value is what ships**.

While both layers wrote the _same_ value, this was invisible. It becomes a defect
the moment they differ — which is exactly what the promotion path does:

- Operator sets `WATCH_CSP_ENFORCE=true` and redeploys.
- `headers()` now emits the full enforced policy.
- Middleware then overwrites it with the static `frame-ancestors 'self'` on every
  rewritten content route.
- The promotion looks done and does nothing, on precisely the routes that matter.

**"One header came back" proves de-duplication, not which layer produced it.** The
discriminating probe is one where the two layers would emit _different_ values.

## The rule

Pick one layer per header, and pick it by what the header has to do:

- **Config** owns any header whose value can vary (a flagged policy, anything
  environment-derived). Middleware must not write that key at all.
- **Middleware** owns a header only when a per-route override is the point — here
  `Referrer-Policy`, because `/preview/experience` must answer `no-referrer` and
  middleware-wins is the mechanism that lets it. Its baseline value is identical,
  so there is nothing to clobber.

Then pin both halves:

- A middleware test asserting the header it must NOT set is **absent**
  (`expect(response.headers.get("content-security-policy")).toBeNull()`).
- A live `next build` + `next start` probe **with the flag on**, against a
  rewritten content route — not just the root, and not just the config unit test,
  neither of which can observe the merge.

## Verification that actually discriminates

Config-shape unit tests assert `nextConfig.headers()`'s own output and can never
see the merge. The probes that do:

```
# default: report-only rides alongside the narrow enforced policy
curl -sD - -o /dev/null http://127.0.0.1:3303/watch/jesus.html | grep -i content-security-policy

# promotion: the FULL policy must reach the rewritten route, report-only gone
WATCH_CSP_ENFORCE=true pnpm --filter @forge/web build
WATCH_CSP_ENFORCE=true npx next start --port 3303
curl -sD - -o /dev/null http://127.0.0.1:3303/watch/jesus.html | grep -i content-security-policy

# the per-route override must still win
curl -sD - -o /dev/null http://127.0.0.1:3303/watch/preview/experience/abc | grep -i referrer-policy
```

Verified by hand 2026-09-22 against `next@16.2.4`.

## A second lesson from the same change

**A CSP's host allowlist cannot be derived by grepping the source.** Loading the
real page under the report-only policy produced violations for hosts that appear
nowhere in application code:

- HLS playback starts at `stream.mux.com` but hands off to regional CDN hosts
  (`manifest-oci-…fastly.mux.com`, `chunk-oci-…fastly.mux.com`).
- Subtitles come from `api-media-core.jesusfilm.org`.

A grep-derived policy looked complete and would have killed playback and subtitles
on promotion. Report-only is not only a safety posture — it is the **measuring
instrument**. Ship it, load the real page against real data, and read the reports.

Corollary: `upgrade-insecure-requests` is silently ignored in a report-only policy,
so it can never be measured there and would switch on unexercised at promotion.
Leave out any directive report-only mode cannot exercise.

Third-party intake hosts deserve the same suspicion: Datadog RUM posts to
`browser-intake-us3-datadoghq.com` for site `us3.datadoghq.com` — an **infix**, not
a subdomain — so `*.datadoghq.com` matches none of the regional intakes. Derive the
intake host from the configured site rather than guessing a wildcard.

## Related

- `docs/solutions/architecture-patterns/fail-closed-enforcement-point-follows-rollback-capability.md`
  — why report-only ships first; this note is what makes the later flip real.
- `docs/solutions/web/nextjs-headers-defeats-route-cache.md` — the _other_
  `headers()`. That one is the runtime `next/headers` API in a page route, which
  forces dynamic rendering. Config `headers()` does not; `/watch` still served
  `x-nextjs-cache: HIT` and the route table was byte-identical after this change.
