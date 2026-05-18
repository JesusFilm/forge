---
title: Railway logsV2 silences console.log AND console.warn from Next.js App Router runtime route handlers — only console.error surfaces
date: 2026-05-18
last_updated: 2026-05-18
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

# Railway logsV2 silences console.log AND console.warn from Next.js App Router runtime route handlers — only console.error surfaces

## Problem

`console.log(JSON.stringify({ event: "...", ... }))` **AND**
`console.warn(JSON.stringify({ ... }))` calls from inside Next.js App
Router route handlers (both REST routes under
`src/app/api/*/route.ts` and GraphQL resolvers under
`src/graphql/queries/*.ts`) do NOT surface in Railway's
`deploymentLogs` GraphQL query when invoked during runtime request
serving, even though:

- `console.error(...)` from the same files DOES surface.
- `console.log(...)` from module-load / boot phase (Prisma migration
  output, "Next.js Ready" line) DOES surface.

**Initial hypothesis (wrong):** "stdout silenced, stderr surfaces" —
suggested switching `console.log` → `console.warn` would fix it.
**Verified empirically wrong 2026-05-18** against admin deployment
`a8bf6273` on commit `69126099f0` (PR #970 + #971 merged): zero
`search.request` lines appeared even after the switch to
`console.warn`. PR #972 corrects this — only `console.error`
surfaces in practice.

The result: structured-log observability for per-request events
must use `console.error` on this stack, even when the events are
not semantically errors. The semantic mismatch (log-as-error) is
operationally unavoidable until a structured-logger migration lands.

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

**Emit structured logs via `console.error` on this stack.**
`console.warn` is also silenced; `console.error` is the only channel
that surfaces from runtime route handlers in Railway's logs.

```ts
// Silently dropped:
console.log(JSON.stringify({ event: "search.request", ... }))

// Also silently dropped (PR #970 — verified wrong 2026-05-18):
console.warn(JSON.stringify({ event: "search.request", ... }))

// Surfaces reliably (PR #972 — the working channel):
console.error(JSON.stringify({ event: "search.request", ... }))
```

The structured-JSON payload is byte-identical across all three.
Only the console method changes.

**Semantic mismatch is real but unavoidable.** `search.request` is
a per-request operational event, not an error. Tagging it as
`error` severity in Railway's dashboard misrepresents its
operational meaning. Operators who filter logs by severity will
see search.request events alongside genuine errors. The right
long-term fix is a structured logger (Pino + Next.js
instrumentation hook) that writes to stderr regardless of semantic
severity, with the actual severity encoded in the JSON payload.
Until that lands, `console.error` is the pragmatic floor.

**Update tests to spy on `console.error` instead of `console.log`/`console.warn`:**

```ts
beforeEach(() => {
  logSpy = vi.spyOn(console, "error").mockImplementation(() => {})
})
```

Note: the spy will also capture genuine error logs from the same
file (e.g., `[search] Search failed: ...` in the catch branch).
Filter the captured log lines by event name when asserting:

```ts
const searchRequestLines = logSpy.mock.calls
  .map((args) => String(args[0] ?? ""))
  .filter((line) => {
    try {
      const parsed = JSON.parse(line)
      return parsed.event === "search.request"
    } catch {
      return false
    }
  })
```

## Why this works

Railway's logsV2 pipeline captures `console.error` output from
runtime route handlers but NOT `console.log` or `console.warn`. In
Node's standard library, all three of `console.log`, `console.warn`,
and `console.error` eventually call `process.stdout.write` /
`process.stderr.write` — so naïvely they should be functionally
identical at the streams layer. Yet experimentally, only
`console.error` surfaces on this stack. The most plausible
explanations (untested):

- Next.js 16 standalone installs a `console` interceptor that
  special-cases `console.error` (e.g., routes it through a separate
  flush mechanism, attaches different metadata, or marks it for
  different sampling).
- Railway's logsV2 collector pattern-matches stderr output and only
  forwards lines that look like Node's `console.error` format
  (which prepends a specific prefix in some configurations).
- A combination — Next.js writes warn/log to a buffered stream that
  doesn't flush until process exit, while error writes through to
  a different stream.

Empirical truth (verified 2026-05-18 against admin deployment
`a8bf6273` running:

- Next.js 16.2.4
- Node 24.15.0
- Railway runtime V2
- `logsV2: true` (per `deployment.meta.logsV2`)
- standalone build output
- Railpack-built image

The exact root cause is unclear (Next.js standalone behavior, Node
24 stdio handling, Railway's log-collector configuration, or some
interaction of the three). The behavior is consistent and
reproducible: switch to `console.error` and the lines surface.

## Prevention / How to apply

**Default rule for structured logging in admin's request path:**
emit via `console.error(JSON.stringify(...))`. Yes, even for events
that are not semantically errors. The semantic mismatch is the
price of having ANY observability — `console.log` and `console.warn`
both silently drop on this stack.

**Specifically affected patterns:**

- `console.log(JSON.stringify({event: ..., ...}))` for structured
  per-request observability events — silenced.
- `console.warn(JSON.stringify({event: ..., ...}))` — also
  silenced (PR #970 attempted this and verified wrong).
- Audit logs, operational metrics, structured request tags.

**Patterns that DON'T need this workaround:**

- Boot-time / module-load `console.log` — surfaces fine (so the
  Prisma + Next.js startup logs you see ARE the whole stdout story
  from boot; they're just from a different phase than runtime
  handlers).
- `process.stderr.write(...)` — direct stderr, surfaces fine.
  Skip the console abstraction entirely if you want fully
  predictable behavior at the cost of losing console formatting.
- CLI scripts run via `pnpm --filter @forge/admin run-embeds` etc.
  — these aren't App Router request handlers, so console.log works
  fine.
- One-shot operational logs from useworkflow durable jobs — those
  run in their own process / context, not Next.js App Router
  runtime, so they're unaffected.

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
  exposing the bug); #970 (FIRST workaround — `console.log` →
  `console.warn`, **verified wrong** 2026-05-18 against deployment
  `a8bf6273`); #972 (CORRECT workaround — `console.warn` →
  `console.error`).
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
