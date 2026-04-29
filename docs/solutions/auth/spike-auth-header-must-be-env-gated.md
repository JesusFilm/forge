---
title: "Spike auth headers must be gated by NODE_ENV, and workflow principals must not be mintable from user input"
category: auth
date: 2026-04-13
tags:
  - auth
  - graphql
  - permissions
  - security
  - admin
problem_type: security_issue
component: apps/admin/src/graphql/context.ts
---

## Problem

The admin app's Unit 6 GraphQL context read an `x-spike-role` header as a
stand-in for real authentication (Better Auth lands in Unit 5). The parser
accepted `ADMIN`, `EDITOR`, `VIEWER`, and `SYSTEM` with no environment
guard:

```ts
// BEFORE — exploitable on any deployed environment
const SPIKE_ROLES: readonly Role[] = [
  "ADMIN",
  "EDITOR",
  "VIEWER",
  "SYSTEM",
] as const

function parseSpikeRole(header: string | null): Role | null {
  if (header === null) return null
  const trimmed = header.trim().toUpperCase()
  return (SPIKE_ROLES as readonly string[]).includes(trimmed)
    ? (trimmed as Role)
    : null
}
```

Two failure modes:

1. **Arbitrary privilege escalation in production.** Anyone who could reach
   `/api/graphql` (Cloudflare-fronted, but still internet-facing) could set
   `x-spike-role: ADMIN` and get an ADMIN principal for the request. The
   permission system behind it was correct — `hasPermission` + named ABAC
   helpers — but the principal was forged at the door.

2. **Workflow trust boundary bypassed by a user-supplied header.** `SYSTEM`
   is a separate, orthogonal tier reserved for in-process workflow
   principals (useworkflow jobs writing derived columns like
   `ExperienceLocale.embedding`). Including `SYSTEM` in the spike set
   meant any HTTP caller could impersonate a workflow principal and pass
   `system:write-derived` scope gates.

## Root cause

Spike auth was written as a purely developer-ergonomic convenience for
testing the Unit 3 scope-auth architecture. The assumption was "Unit 5
will replace this before deploy" — but that assumption is not a technical
control. Anything that ships compiled into the deployed bundle runs in
production until explicitly deleted. A conditional gate in source code is
cheaper than a mental promise across five implementation units.

Compounding the problem: `SYSTEM` was added to the spike set so that
scope-auth tests could cover the `system:*` permissions. Expanding the
spike surface to cover more test scenarios expanded the attack surface in
lockstep.

## Solution

Two changes, both as small as possible:

### 1. Gate the header behind NODE_ENV

```ts
// AFTER — header is ignored entirely on production builds
function parseSpikeRole(header: string | null): Role | null {
  if (header === null) return null
  if (process.env.NODE_ENV === "production") return null
  const trimmed = header.trim().toUpperCase()
  return (SPIKE_ROLES as readonly string[]).includes(trimmed)
    ? (trimmed as Role)
    : null
}
```

Production builds see `NODE_ENV === "production"` under Next.js, so the
header short-circuits to `null` and every request defaults to PUBLIC
until Unit 5 ships. Local dev (`next dev`) and test runs (`vitest`, which
defaults to `"test"`) still get the dev-ergonomic header path.

### 2. Remove SYSTEM from the spike role set

```ts
// AFTER — SYSTEM cannot be minted via header, ever
const SPIKE_ROLES: readonly Role[] = ["ADMIN", "EDITOR", "VIEWER"] as const
```

`SYSTEM` is granted only by the workflow runtime's in-process
authentication path (Unit 11). A request arriving over HTTP can never be
a workflow principal, regardless of what header it carries. Keep the
editorial/workflow boundary impossible to cross at the context builder.

### 3. Prove both gates with tests

A gated path without a test rots. Add a test file next to
`context.ts` that stubs `process.env.NODE_ENV` and asserts both:

- Non-production: `ADMIN`, `EDITOR`, `VIEWER` resolve; `SYSTEM` and
  unknown values return PUBLIC.
- Production: every spike-role value returns PUBLIC.

```ts
describe("production", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "production"
  })

  it("ignores x-spike-role=ADMIN in production", async () => {
    const ctx = await createContext({
      request: new Request("http://localhost/api/graphql", {
        headers: { "x-spike-role": "ADMIN" },
      }),
    })
    expect(ctx.user).toBeNull()
  })
})
```

## Prevention

Three rules that apply to any pre-real-auth scaffolding:

1. **Every placeholder auth path starts with an environment gate.** Write
   it the first time — even a `if (process.env.NODE_ENV === 'production')
return null` at the top of the parser is enough. Don't rely on "we'll
   swap it out in Unit N" — deployable code that trusts an external
   input is an exploit regardless of how you mean to replace it.

2. **Workflow/system principals are never produced from HTTP input.**
   They originate from an in-process trust anchor (job queue, cron,
   signed IPC, etc.). If you need the system tier to appear during scope-
   auth testing, mock the context at the unit-test layer — don't open a
   header path.

3. **Spike surfaces grow to match test coverage; keep the inclusion list
   minimal.** Every role added to the spike set is a role someone can
   claim. If a test needs a role that the spike header doesn't grant,
   write the test against a constructed context instead of widening the
   header contract.

## Verification

- `context.test.ts` — 2 production-gate assertions + 4 non-production
  resolution assertions + 1 SYSTEM-exclusion assertion
- `permissions.test.ts` — `canWriteDerived(SYSTEM) === true` still passes
  (workflow path is unchanged; only the _HTTP-to-SYSTEM_ path is removed)
- Manual: `curl -H 'x-spike-role: ADMIN' https://<prod-host>/api/graphql`
  must return unauthenticated errors for any non-public query

## Related

- `apps/admin/src/graphql/context.ts` — the gated parser
- `apps/admin/src/graphql/context.test.ts` — env-gate tests
- `apps/admin/src/auth/permissions.ts` — the permission matrix this
  header was forging principals against
- Unit 5 of the admin-app plan replaces this path entirely with Better
  Auth session resolution + Firebase fallback
