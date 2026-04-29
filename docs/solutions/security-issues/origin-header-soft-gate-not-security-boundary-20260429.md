---
title: "Origin header is a soft feature gate, not a security boundary"
category: "security-issues"
problem_type: "security_issue"
component: "authentication"
root_cause: "missing_validation"
resolution_type: "documentation_update"
severity: "low"
module: "apps/cms"
tags:
  - cors
  - origin-header
  - authentication
  - threat-model
  - debug-payload
  - api-security
date: "2026-04-29"
related_prs:
  - "JesusFilm/forge#feat-109"
related_docs:
  - "docs/solutions/security-issues/yoga-cors-origin-undefined-allows-all-origins.md"
---

## Problem

When gating internal-only response payloads (debug fields, scoring
internals, admin previews) by `Origin` header, it's tempting to call the
gate "security." It isn't. Browsers set `Origin` automatically and
forbid client-side override, but **any non-browser HTTP client** (curl,
agents, server-to-server, MCP tools, an attacker with `nc`) can spoof
it. An Origin allowlist prevents accidental browser exposure; it does
not prevent intentional access.

## Symptoms

- A `debug=true` query param exposes per-result scoring detail in
  responses.
- Gate is `origin in allowlist` (CSV env var or `NODE_ENV !== "production"`).
- Reviewer asks: "what stops curl from sending `Origin: http://localhost:3000`?"
- Answer: nothing. The gate is bypassed in seconds.

## What Didn't Work

- Treating Origin gating as authentication. It isn't authenticated;
  the header is fully attacker-controlled outside browsers.
- Reasoning "production has no allowlisted origin so it's safe."
  `NODE_ENV !== "production"` defaults can leak debug payloads from
  staging/preview environments to anyone who guesses the URL — and
  preview environments often hold near-prod data.

## Solution

**Document Origin gating as a soft feature flag, not a security
boundary.** Be explicit in the code about the threat model:

```ts
/**
 * **Threat model — the Origin header is NOT an authentication
 *  mechanism.** Browsers set `Origin` automatically and forbid
 *  client-side override, but any non-browser HTTP client (curl,
 *  server-to-server, an MCP tool, an attacker with `nc`) can send
 *  `Origin: <any-allowlisted-host>` and unlock the payload. The gate
 *  is therefore best treated as a *soft feature flag* that prevents
 *  accidental browser-based exposure, not as a security boundary. If
 *  the payload ever changes to carry user-scoped data — e.g. PII,
 *  credentials, or row-level secrets — replace this gate with a
 *  server-side authenticated check (signed token, allowlisted IP
 *  range, internal-only network path) before relying on it.
 */
```

**Always fail closed when Origin is undefined or empty.** Mirrors the
yoga-cors institutional learning. A missing Origin header is the
default for any non-browser client, including legitimate agents — but
that's the right tradeoff: agents that need access on a deployed
environment can opt in by setting Origin manually, or operators can
add a token-based gate as a follow-up.

```ts
export function isDebugAllowedForOrigin(origin: string | undefined): boolean {
  if (origin == null || origin.length === 0) return false // fail closed
  // ... allowlist check
}
```

**Promote to a real auth gate when the threat model changes.** The
moment the gated payload starts carrying user-scoped data, the Origin
gate is insufficient. Acceptable replacements:

- A signed admin JWT
- An allowlisted internal IP range / Cloudflare Zero Trust
- A shared `X-Internal-Token` header validated server-side
- An internal-network-only route (private Railway service)

## Why This Works

The Origin header was designed to prevent **CSRF** — to give servers
information about which other site initiated a cross-origin request.
Browsers enforce its truthfulness for browser-originated traffic. There
is no enforcement for non-browser traffic, by design — Origin is a
report, not a guarantee.

A correct threat model treats Origin as:

- **Reliable for browser → server scenarios** (the browser will set the
  real Origin or won't send the header).
- **Unreliable for non-browser → server scenarios** (any value can be
  sent).

The gate is therefore useful for "stop the React app on prod from
accidentally requesting this" but useless for "stop a determined
attacker from requesting this."

## Prevention

1. **Document the threat model at the gate.** Future readers see the
   trade-off without having to reverse-engineer it.
2. **Audit gated payloads for sensitivity.** If the payload is internal
   scoring detail, Origin gating is fine. If it's user data, it's not.
3. **Never use Origin alone for write operations.** Writes are the
   high-risk surface; pair Origin (if used at all) with a CSRF token or
   server-side authentication.
4. **Test fail-closed semantics explicitly.** Cover undefined origin,
   empty-string origin, and unallowlisted origin in unit tests. The
   yoga-cors gotcha (origin: undefined matching all origins) is the
   classic regression.

## Related

- `apps/cms/src/api/search/services/debug-allowlist.ts` — feat-109
  origin gate with the threat-model docstring.
- `docs/solutions/security-issues/yoga-cors-origin-undefined-allows-all-origins.md` —
  the upstream yoga-cors gotcha and the fail-closed fix it prescribes.

## Admin-side counterpart

- `apps/admin/src/services/hybrid-search-debug-allowlist.ts` — verbatim
  port of the cms gate to admin's R4-extension keyword-first surface.
  Same threat model docstring; same fail-closed-on-undefined posture.
- `apps/admin/src/services/hybrid-search-debug-allowlist.test.ts` —
  origin-gate behavior across env + allowlist combinations.
- `apps/admin/src/app/api/search/route.ts` + `apps/admin/src/graphql/queries/hybrid-search.ts`
  — the two boundary integrations consulting the gate.
- `docs/solutions/platform/admin-hybrid-search-keyword-first-r4-extension-pattern.md`.
