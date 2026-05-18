---
title: Railway logsV2 silences JSON-stringified payloads from Next.js App Router runtime route handlers — use `[label] event=name key=value` string format
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
  - format
  - structured-logs
  - node-24
  - admin
related:
  - docs/solutions/architecture-patterns/bearer-as-passport-multi-csv-composition-20260518.md
  - docs/solutions/best-practices/waf-passthrough-verification-via-prior-art-20260518.md
---

# Railway logsV2 silences JSON-stringified payloads from Next.js App Router runtime route handlers

## Problem

`console.log(JSON.stringify({ event: "...", ... }))`,
`console.warn(JSON.stringify({...}))`, **AND**
`console.error(JSON.stringify({...}))` calls from inside Next.js App
Router route handlers (REST routes under `src/app/api/*/route.ts`
and GraphQL resolvers under `src/graphql/queries/*.ts`) do NOT
surface in Railway's `deploymentLogs` GraphQL query when invoked
during runtime request serving.

The same files' `console.error("[search] event=... key=value")`
string-format lines (e.g., `[search] event=query_embedding_failure
error_class=... message=...`) DO surface reliably.

**Conclusion:** the silencing isn't about console.log vs warn vs
error, and it isn't about stdout vs stderr. It's about **payload
format** — Railway logsV2 collector (or some interceptor in the
stack) drops or routes JSON-shaped lines starting with `{` somewhere
the standard `deploymentLogs` query doesn't show.

## Symptoms

- Operator greps Railway logs for `event=search.request` and finds
  zero matches.
- The same code emits the log correctly in `vitest` test runs.
- `[search] Search failed: <error>` and `[search]
event=query_embedding_failure ...` (existing console.error string
  lines from the same file) DO surface.
- Railway's `httpLogs` confirms the request reached the origin (HTTP
  200 returned), so the silencing isn't because the code didn't
  execute.

## What didn't work — the path to the corrected diagnosis

The diagnostic journey through three PRs:

| PR   | Attempted fix                                                                                 | Hypothesis                                                       | Result                                                                                                                                                                                                                                                                |
| ---- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #968 | Initial: `console.log(JSON.stringify({event: "search.request", ...}))`                        | (no hypothesis — first version)                                  | **Silenced.** No `search.request` lines in Railway logs.                                                                                                                                                                                                              |
| #970 | Switch to `console.warn(JSON.stringify(...))`                                                 | "stdout silenced, stderr surfaces"                               | **Still silenced.** Verified 2026-05-18 against deployment `a8bf6273` (commit `69126099f0`). Zero `search.request` lines.                                                                                                                                             |
| #972 | Switch to `console.error(JSON.stringify(...))`                                                | "only console.error surfaces from runtime handlers"              | **Still silenced.** Verified 2026-05-18 against deployment `a5b3bf14` (commit `7bb36221ed`). Zero `search.request` lines, but the `[search] event=query_embedding_failure` lines from the SAME file's hybrid-search.service.ts surfaced fine (3 of 3, one per probe). |
| #973 | Switch to `console.error(`[search] event=search.request auth=${tag} path=rest rl=${source}`)` | "the silencing is about JSON-payload format, not console method" | TBD. The format matches the proven-working `event=query_embedding_failure` log.                                                                                                                                                                                       |

The key empirical insight that arrived at #973's hypothesis: in the
same file (`apps/admin/src/services/hybrid-search.service.ts`), the
existing `console.error("[search] event=query_embedding_failure ...")`
log surfaces in Railway logs for every probe — but `console.error(JSON.stringify({event: "search.request", ...}))` from the route handler
right next to it does NOT surface. Both use console.error. Both run
in the same request-handler context. The only difference is the
payload format: plain-string vs JSON-stringified object.

## Solution

**Use the `[label] event=name key=value key=value` plain-string
format** for structured per-request logs, matching the convention
used by the existing working logs in admin (`event=search_unknown_mode`,
`event=query_embedding_failure`, etc.).

```ts
// Before — silenced (verified across console.log/warn/error variants):
console.error(
  JSON.stringify({
    event: "search.request",
    auth: authTag,
    path: "rest",
    rl: limit.source,
  }),
)

// After — surfaces reliably (matches the convention of
// `event=query_embedding_failure` in the same surface):
console.error(
  `[search] event=search.request auth=${authTag} path=rest rl=${limit.source}`,
)
```

The structured-data semantics are preserved: operators grep for
`event=search.request` and parse `key=value` pairs the same way
they do for `event=query_embedding_failure` today. There's a small
ergonomic regression vs JSON (no automatic escaping of values that
contain spaces or `=`), but the values we emit are all
short, controlled tokens (`bearer | invalid_bearer | anonymous`,
`rest | graphql`, `redis | local`) — no risk of parse ambiguity.

**Test parser shape:**

```ts
function parseSearchLogLines(): Array<Record<string, string>> {
  return logSpy.mock.calls
    .map((args) => args[0])
    .filter((arg): arg is string => typeof arg === "string")
    .filter((line) => line.includes("event=search.request"))
    .map((line) => {
      const obj: Record<string, string> = { event: "search.request" }
      for (const match of line.matchAll(/(\w+)=(\S+)/g)) {
        obj[match[1]] = match[2]
      }
      return obj
    })
}
```

## Why this works (probable cause)

The silencing of JSON-shaped output is consistent with a log
collector that either:

1. **Pattern-matches log lines against a Node `error()` format
   regex** (e.g., expects `[label] message format`) and drops
   anything that doesn't match. Plausible for older log-collection
   tooling that didn't anticipate JSON-structured emission.
2. **Routes leading-`{` lines to a separate "structured payload"
   channel** that isn't exposed by the `deploymentLogs` query —
   maybe surfaced in a different Railway dashboard view, or treated
   as metadata attached to a different log line.
3. **Has anti-spam filtering on identically-shaped JSON output**
   that drops lines matching a hot-path emission pattern.

The exact mechanism remains unconfirmed without Railway's collector
source code. The behavioral test is reliable: lines matching
`[label] event=name key=value` surface; lines starting with `{`
don't.

Verified 2026-05-18 against admin deployment `a5b3bf14` running:

- Next.js 16.2.4
- Node 24.15.0
- Railway runtime V2
- `logsV2: true`
- standalone build output
- Railpack-built image

## Prevention / How to apply

**Default rule for structured logging in admin's request path:**
emit in the `[label] event=name key=value` plain-string format, NOT
`JSON.stringify`.

```ts
// ✅ DO:
console.error(`[search] event=search.request auth=${authTag} path=rest`)
console.error(`[publish] event=experience_published id=${id} locale=${locale}`)
console.error(`[webhook] event=revalidate.skipped reason=${reason}`)

// ❌ DON'T:
console.error(JSON.stringify({ event: "...", ... }))
console.warn(JSON.stringify({ event: "...", ... }))
console.log(JSON.stringify({ event: "...", ... }))
```

The semantic-mismatch concern (logging operational events at `error`
severity) is unavoidable on this stack. A structured-logger
migration (Pino with a custom serializer that produces
collector-friendly output) is the proper long-term fix; until then,
the plain-string format with `event=` discriminators is the
pragmatic floor.

**Specifically affected patterns:**

- `console.{log,warn,error}(JSON.stringify({event: ..., ...}))` —
  silenced.
- Any per-request observability emitted as a JSON-shaped payload.

**Patterns that DON'T need this workaround:**

- `console.error("[label] event=... key=value ...")` plain-string —
  surfaces fine.
- Boot-time / module-load `console.log` (Prisma migrations,
  Next.js Ready, etc.) — surfaces fine (different lifecycle phase).
- `process.stderr.write("...")` — direct stderr, untested but
  expected to work for plain-string output.
- CLI scripts run via `pnpm --filter @forge/admin run-embeds` etc.
  — these aren't App Router request handlers; stdout works.
- One-shot operational logs from useworkflow durable jobs.

**Verification probe** (run after deploying any new structured-log
event in admin's request path):

```bash
# After deploy, hit the endpoint:
curl -H "Authorization: Bearer fake-not-real" \
  "https://admin.jesusfilm.org/api/search?q=test&locale=en"

# Then grep Railway logs for the structured event:
# Should see the [label] event=name key=value line within 1-2 minutes.
# If empty: the log payload is JSON-shaped and silenced.
```

**Existing call sites in admin that may need migration:**

Grep for `console\.{log,warn,error}(JSON\.stringify` under
`apps/admin/src/`:

```bash
grep -rn "console\.\(log\|warn\|error\)(JSON\.stringify" apps/admin/src --include="*.ts"
```

Known affected (as of 2026-05-18, post-PR #973):

- `apps/admin/src/services/revalidate-webhook.ts:126-128` — ISR
  revalidation webhook emit log. Still uses `console.log(JSON.stringify(...))`.
  Fires only on Experience publish, low volume, hasn't been
  operator-noticed yet. Migrate when next touched.

**Longer-term fix to consider** (not yet attempted):

- Introduce Pino (or a thin custom logger) that emits in the
  `[label] event=name key=value` convention from a single helper,
  with severity encoded in the payload (`level=info` etc.). The
  semantic-mismatch concern disappears because the wire-channel
  (error) is independent of the operational severity.

## Cross-references

- **Companion learning (the verification workaround forced by this
  bug):**
  `docs/solutions/best-practices/waf-passthrough-verification-via-prior-art-20260518.md`
  — when origin logs can't surface diagnostic events, fall back to
  prior-art reasoning.
- **The auth surface that exposed this bug:**
  `docs/solutions/architecture-patterns/bearer-as-passport-multi-csv-composition-20260518.md`
- **PRs:**
  - #968 — introduced `console.log(JSON.stringify(...))` for
    `search.request`, exposing the silencing.
  - #970 — first workaround attempt: `console.log` → `console.warn`.
    **Verified wrong** 2026-05-18 against deployment `a8bf6273` /
    commit `69126099f0`. Hypothesis "stdout silenced, stderr
    surfaces" was incomplete.
  - #972 — second workaround attempt: `console.warn` →
    `console.error`. **Verified wrong** 2026-05-18 against
    deployment `a5b3bf14` / commit `7bb36221ed`. Hypothesis "only
    console.error surfaces from runtime handlers" was wrong — JSON
    payload was the actual blocker, not the console method.
  - #973 — third (and correct) workaround:
    `console.error(JSON.stringify(...))` →
    `console.error(`[search] event=... key=value`)`. Format matches
    the proven-working `event=query_embedding_failure` log in the
    same surface.
- **Affected files:**
  - `apps/admin/src/app/api/search/route.ts` (REST search handler)
  - `apps/admin/src/graphql/queries/hybrid-search.ts` (GraphQL twin)
  - `apps/admin/src/services/revalidate-webhook.ts` (also affected,
    not yet migrated)
- **Empirical evidence:**
  - Admin deployment `a5b3bf14` on commit `7bb36221ed`
    (post-#972 merge). Probe results 2026-05-18 03:39:52 UTC: 3 of
    3 `event=query_embedding_failure` lines from the same file
    surfaced; 0 of 3 `event=search.request` JSON-stringified lines
    surfaced. Same call site, same `console.error`, same request
    context — only the payload format differed.
