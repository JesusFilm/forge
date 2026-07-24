---
id: "feat-304"
title: "Production egress pin for the chat → Mastra host allowlist"
owner: "jian wei"
priority: "P2"
status: "in-progress"
start_date: "2026-07-23"
duration: 1
depends_on:
  - "feat-282"
  - "feat-294"
blocks:
  - "feat-305"
tags:
  - "web"
  - "infrastructure"
---

## Problem

`SEEKER_MASTRA_ALLOWED_HOSTS` has existed since feat-205 as an optional CSV SSRF
allowlist, but it has never been set — not in production, not locally. Unset, it
contributes nothing: `hostAllowed` short-circuits with `if (!allowedHostsCsv)
return true`, so the only surviving control on the outbound base URL is the
scheme floor (https, with the loopback and `*.railway.internal` http carve-outs).

That floor admits **any** `https://` host. So a typo'd, mispasted, or tampered
`SEEKER_MASTRA_BASE_URL` sends the `AI_CHAT_MASTRA_API_KEY` lane bearer — plus
the user's prompt text — to whatever that host is. The allowlist is the one
control that closes it, and it is inert in every environment.

The var therefore reads to a reviewer (or an agent) as though egress is pinned
when it is not. Either set it and make it load-bearing, or delete it; leaving an
unset fail-open allowlist in place is the worst of the three.

This ticket does the former. The var stays `.optional()` — chat's "every var
optional, boots clean with none set" contract and the repo's
`required-env-var-without-default-broke-railway-deploy` law both forbid making it
required — but what UNSET MEANS becomes environment-dependent.

## Entry Points — Read These First

1. `apps/chat/src/lib/server/mastra-upstream.ts` — `hostAllowed` (the scheme
   floor + allowlist) and `validateBaseUrl` (the `ValidatedBaseUrl` mint from
   feat-294). Both gain the new policy argument.
2. `apps/chat/src/config/env.ts` — the zod schema (`SEEKER_MASTRA_ALLOWED_HOSTS`
   at the top) and where the new policy + boot diagnostic live.
3. `apps/chat/src/app/api/seeker/route.ts` — `SeekerProxyConfig` and the `POST`
   wrapper that builds config from env.
4. `apps/chat/src/app/api/history/history-proxy.ts` — `HistoryProxyConfig` and
   the existing `buildHistoryProxyConfig()` (the shape the seeker side should
   mirror).
5. `apps/web/src/instrumentation.ts` — the repo's existing never-throw
   `register()` hook; the template for chat's.
6. `apps/chat/railway.toml` — confirm for yourself there is **no**
   `healthcheckPath`. This single fact drives the enforcement-point decision
   below.
7. `apps/mastra/src/config/env.ts` — the sibling `JESUSFILM_RAG_ALLOWED_HOSTS` /
   `LANGFUSE_ALLOWED_HOSTS` guards, which are fail-closed **at boot**. Chat
   deliberately diverges; understand why before copying them.

## Grep These

```bash
# Every guard call site that must thread the new policy
grep -rn "hostAllowed\|validateBaseUrl" apps/chat/src

# The two env-reading config builders — the silent-revert surface
grep -rn "requireAllowlist\|SEEKER_MASTRA_ALLOWED_HOSTS" apps/chat/src

# Sibling boot-throw guards (the pattern chat does NOT follow)
grep -rn "ALLOWED_HOSTS" apps/mastra/src/config/env.ts

# Prose that describes the old fail-open posture and will go stale
grep -rniE "unset.*(trusted|operator-set)" docs/solutions apps/chat
```

## What To Build

**1. The policy, in `config/env.ts`.** Keep the schema entry `.optional()`.

```ts
export function requireSeekerEgressAllowlist(): boolean {
  return env.NODE_ENV === "production"
}
```

Armed by `NODE_ENV`, so the real trigger is any production **build** — every
deployed environment and a local `next build && next start`, not only the one an
operator calls "production". Only `next dev` and the test runner stay fail-open.
Say this explicitly in the JSDoc; "production only" is the wording that misleads.

**2. Thread it through the guard as a REQUIRED third argument** (no default) on
both `hostAllowed` and `validateBaseUrl`:

```ts
if (!allowedHostsCsv) return !requireAllowlist
```

No default is the point: a defaulted flag lets a future call site silently
inherit fail-open. Required means the compiler forces every caller to state a
policy — the same guard-then-use reasoning feat-294 applied to the brand.

**3. Carry it on both proxy configs** (`SeekerProxyConfig`,
`HistoryProxyConfig`) as `requireAllowlist: boolean`, built from
`requireSeekerEgressAllowlist()`. Extract `buildSeekerProxyConfig()` so the
seeker route has a testable env-reading builder mirroring
`buildHistoryProxyConfig()`. Deny wires are unchanged: seeker emits its terminal
`ssrf_blocked` SSE frame, history returns 502 `unavailable`.

**4. A boot diagnostic in a new `apps/chat/src/instrumentation.ts`** —
`describeSeekerEgressMisconfiguration()` returning a fixed enum
(`allowlist_unset | host_not_allowed | null`), logged as plain-string
`[seeker-egress] event=misconfigured reason=…` (Railway logsV2 silences
JSON-stringified payloads).

**Enforcement is at the proxies, NOT a boot throw — this is the load-bearing
design decision.** Next rethrows from `register()`, and that rejection
propagates into `prepare()`, which in production is awaited on the **first
request** and whose rejected promise is then cached — so every request fails
forever. With no healthcheck in `railway.toml`, nothing rolls that back. A boot
throw would take down anonymous stub chat, the page, and auth over a Seeker-only
misconfiguration. The hook therefore only reports, and must never throw —
`try/catch` the whole body (the dynamic import alone can throw: `@/config/env`
now reaches `server-only`).

**5. Set the var.** `SEEKER_MASTRA_ALLOWED_HOSTS=<mastra-service>.railway.internal`
in Railway, hostnames only — no scheme, no port (entries are compared against
`new URL(baseUrl).hostname`). `.env.example` ships `localhost` to match its
localhost base URL.

## Constraints

- **Do NOT make the var required in zod.** `.optional()` is mandated by the
  repo's opt-in-env-var law; a required-at-load var bricks Railway deploys for
  unprovisioned environments and breaks chat's zero-env boot.
- **Do NOT throw from `register()` in this ticket.** See above. The boot-throw
  option becomes viable once `apps/chat/railway.toml` has a `healthcheckPath`
  (feat-305) and it is observed gating a real deploy; the upgrade itself is
  feat-306. Until both land, a throw here is an unrecoverable outage.
- **Do NOT give the third parameter a default.** The compile error at every call
  site is the feature.
- **Do NOT let `lib/server/mastra-upstream.ts` read env.** It is pure by
  contract; the policy is injected. `config/env.ts` imports the pure
  `hostAllowed`, never the reverse — a transport-side env read would create an
  `env → mastra-upstream → env` cycle.
- **Deploy ordering is a hard prerequisite.** The env var must be set in an
  environment BEFORE code requiring it ships there. Reverse order gives a
  deploy that succeeds while every send is `ssrf_blocked` and the history
  sidebar 502s until someone reads the boot log.
- Scope is the chat → Mastra egress path only. Do not touch admin's
  `MASTRA_CHAT_ALLOWED_HOSTS` or mastra's boot-throw guards.

## Verification

```bash
pnpm --filter @forge/chat test        # suites incl. the new wiring pins
pnpm --filter @forge/chat typecheck
pnpm --filter @forge/chat lint

# The build must NOT fail on a violated pin — Next skips register() during
# phase-production-build. Run with the pin deliberately broken:
SEEKER_MASTRA_BASE_URL=https://mastra.internal pnpm --filter @forge/chat build

# The hook must actually register and log at server start (unit tests import
# the module directly and cannot prove this):
SEEKER_MASTRA_BASE_URL=https://mastra.internal pnpm --filter @forge/chat start
#   expect: [seeker-egress] event=misconfigured reason=allowlist_unset …
#   and the server keeps serving — it must NOT dead-start
```

**Falsification is required, not optional.** Tests that cannot go red are worth
nothing here. Sabotage each of these one at a time and confirm a targeted
failure, then restore from a scratchpad copy with `sha256sum` (never `git
checkout` — the tree is uncommitted and git restores to HEAD):

1. `return !requireAllowlist` → `return true` in `hostAllowed`.
2. `requireAllowlist: requireSeekerEgressAllowlist()` → `false` at **each**
   config builder independently. This is the one-line revert that otherwise
   compiles, typechecks, and leaves the whole suite green — it must be pinned by
   a call-site source test per proxy, with an anti-vacuous companion proving a
   builder hard-coded to `true` also fails.
3. Remove the `try/catch` from `register()` and confirm the rejecting-import
   test goes red.

**Prose sweep.** The retirement/tightening of a documented behavior needs a pass
over markdown that still describes the old posture — at minimum
`docs/solutions/architecture-patterns/browser-sse-proxy-to-bearer-gated-internal-sse-20260626.md`
(guidance #5 asserts an unset allowlist trusts the operator-set host, "should not
must"), plus `apps/chat/CLAUDE.md` and the inline schema comment in
`config/env.ts`. Add dated supersession notes; do not rewrite history.
