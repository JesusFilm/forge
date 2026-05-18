---
title: Railway logsV2 silences info-level stdout from Next.js App Router runtime requests
date: 2026-05-18
problem_type: runtime_error
category: runtime-errors
component: tooling
root_cause: missing_workflow_step
resolution_type: code_fix
severity: medium
tags:
  - railway
  - logsv2
  - nextjs
  - app-router
  - logging
  - observability
  - stdout
  - stderr
  - node-24
  - admin
related:
  - docs/solutions/architecture-patterns/bearer-as-passport-multi-csv-composition-20260518.md
  - docs/solutions/best-practices/waf-passthrough-verification-via-prior-art-20260518.md
---

# Railway logsV2 silences info-level stdout from Next.js App Router runtime requests

## Problem

`console.log(JSON.stringify({ event: "...", ... }))` calls from
inside Next.js App Router route handlers (both REST routes under
`src/app/api/*/route.ts` and GraphQL resolvers under
`src/graphql/queries/*.ts`) do NOT surface in Railway's
`deploymentLogs` GraphQL query when invoked during runtime request
serving, even though:

- `console.error(...)` from the same files DOES surface.
- `console.log(...)` from module-load / boot phase (Prisma migration
  output, "Next.js Ready" line) DOES surface.
- `console.warn(...)` (stderr) DOES surface.

The result: structured-log observability built around `console.log`
is silently absent in Railway's log dashboard, even though it works
correctly in local dev (where stdout pipes to the terminal).

## Symptoms

- Operator greps Railway logs for an event-marker string (e.g.,
  `event=search.request`) and finds zero matches.
- The same code emits the log correctly in `vitest` test runs (where
  the spy captures `console.log`).
- Other log lines from the same file/process — `console.error`,
  boot-time `console.log` — surface correctly.
- Railway's `httpLogs` confirms the request reached the origin (HTTP
  200 returned), so the silence isn't because the code didn't
  execute.
- Severity breakdown via `deploymentLogs(...) { severity }` shows
  `info` logs ARE flowing (boot phase) but the count is suspiciously
  low for a serving production app — only ~20 info-level lines over
  a multi-minute window where dozens of requests were served.

## What didn't work

- **Adjusting the `deploymentLogs` query filter / limit.** Pulling
  500-line windows confirmed no `console.log` lines appeared at all
  for runtime requests. Wasn't a filtering issue.
- **Trying `httpLogs` instead.** Showed request arrival timestamps
  but no payload content. And appeared to filter GETs differently
  from POSTs (GraphQL POST surfaced; REST GET did not).
- **Verifying the deployed commit hash.** Confirmed via Railway's
  `deployment.meta.commitHash` that the deployed code DID contain
  the `console.log` line. Wasn't a stale deployment.
- **Checking severity classification.** Boot `console.log` → info,
  `console.error` → error. The deployed-runtime info-severity lines
  simply weren't appearing — not misclassified, missing entirely.
- **Polling logs for several minutes after each probe.** Wasn't a
  buffering delay. The lines never arrived.

## Solution

**Emit structured logs via `console.warn` (stderr) instead of
`console.log` (stdout) on this stack.**

```ts
// Before (silently dropped by Railway's runtime log pipeline):
console.log(
  JSON.stringify({
    event: "search.request",
    auth: authTag,
    path: "rest",
    rl: limit.source,
  }),
)

// After (surfaces reliably):
console.warn(
  JSON.stringify({
    event: "search.request",
    auth: authTag,
    path: "rest",
    rl: limit.source,
  }),
)
```

The structured-JSON payload is byte-identical. Only the routing
channel (stdout → stderr) changes. The log appears as `warn`
severity in Railway's dashboard, which is a semantic mismatch (the
search.request event isn't a warning), but operationally surfaces
the line.

**Update tests to spy on `console.warn` instead of `console.log`:**

```ts
beforeEach(() => {
  logSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
})
```

## Why this works

Railway's logsV2 pipeline reliably captures stderr from Next.js App
Router runtime requests on the current stack. It captures stdout
from boot/migration phases. It does NOT capture stdout from runtime
request handlers serving HTTP traffic — verified empirically against
admin deployment `c62112c2` running:

- Next.js 16.2.4
- Node 24.15.0
- Railway runtime V2
- `logsV2: true` (per `deployment.meta.logsV2`)
- standalone build output
- Railpack-built image

The exact root cause is unclear (could be Next.js standalone's
stdout buffering, Node 24's stdout-to-pipe handling, Railway's
log-collector configuration, or some interaction of the three). The
behavior is consistent and reproducible: switch to stderr and the
problem disappears.

## Prevention / How to apply

**Default rule for structured logging in this codebase:** emit via
`console.warn` (stderr) by default, not `console.log` (stdout). The
semantic mismatch (log-as-warn) is real but minor; the observability
gain is load-bearing.

**Specifically affected patterns:**

- `console.log(JSON.stringify({event: ..., ...}))` for structured
  per-request observability events.
- Audit logs, operational metrics, structured request tags.

**Patterns that DON'T need this workaround:**

- `console.error(...)` — already stderr, surfaces fine.
- `console.warn(...)` — already stderr, surfaces fine.
- Boot-time / module-load `console.log` — stdout, surfaces fine
  (so the Prisma + Next.js startup logs you see ARE the whole stdout
  story; they're just from a different phase).
- `process.stderr.write(...)` — direct stderr, surfaces fine.
- CLI scripts run via `pnpm --filter @forge/admin run-embeds` etc.
  — these aren't App Router request handlers, so stdout works fine.

**Verification probe** (run after deploying any new structured-log
event in admin's request path):

```bash
# After deploy, hit the endpoint:
curl -H "Authorization: Bearer fake-not-real" \
  "https://admin.jesusfilm.org/api/search?q=test&locale=en"

# Then check Railway logs for the structured event:
# Should see the JSON line within 1-2 minutes.
# If empty: the log emission is in a code path Railway is silencing.
```

**Existing call sites in admin that may need migration:**

Grep for `console\.log(JSON\.stringify` under `apps/admin/src/`:

```bash
grep -rn "console\.log(JSON\.stringify" apps/admin/src --include="*.ts"
```

Known affected (as of 2026-05-18):

- `apps/admin/src/services/revalidate-webhook.ts:126-128` — ISR
  revalidation webhook emit log. Same pattern, same silencing risk.
  Not yet migrated (fires only on Experience publish, low volume,
  hasn't been operator-noticed yet).

**Longer-term fix to consider** (not yet attempted):

- Introduce a structured logger (Pino, Winston) that always writes
  to stderr, with severity metadata in the JSON payload. The
  semantic-mismatch concern disappears because the wire-severity
  is whatever Railway's logsV2 captures, while the in-payload
  `level` field encodes the actual semantic intent.
- Configure Next.js to force-flush stdout per request. Unclear
  whether this is exposed as a configuration option; would need
  investigation.

## Cross-references

- **Companion learning (the verification workaround forced by this
  bug):**
  `docs/solutions/best-practices/waf-passthrough-verification-via-prior-art-20260518.md`
  — when origin logs can't surface diagnostic events, fall back to
  prior-art reasoning.
- **The auth surface that exposed this bug:**
  `docs/solutions/architecture-patterns/bearer-as-passport-multi-csv-composition-20260518.md`
- **PRs:** #968 (introduced `console.log` for `search.request`,
  exposing the bug); #970 (workaround — `console.log` → `console.warn`).
- **Affected files:**
  - `apps/admin/src/app/api/search/route.ts` (the REST search
    handler — primary instance of the bug)
  - `apps/admin/src/graphql/queries/hybrid-search.ts` (the GraphQL
    twin — same bug, same fix)
  - `apps/admin/src/services/revalidate-webhook.ts` (likely also
    affected but not yet migrated)
- **Empirical evidence:**
  - Admin deployment `c62112c2` on commit `a88d269c` (Plan 002
    Phase 1 merge).
  - Verified 2026-05-18: structured `search.request` events from
    runtime request handlers absent from `deploymentLogs(...)` for
    a 5-probe burst window; same file's `console.error` lines from
    the same probe burst surfaced normally.
