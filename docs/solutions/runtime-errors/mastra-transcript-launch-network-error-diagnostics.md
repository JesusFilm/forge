---
title: Mastra transcript launch network errors need upstream diagnostics
date: 2026-06-19
category: runtime-errors
module: apps/admin transcript embedding backfill
problem_type: runtime_error
component: service_object
symptoms:
  - Production transcript embedding smoke returned failed targets with reason network_error
  - Direct AI Gateway model and embedding probes were healthy
  - Admin logs did not show the upstream Mastra status or response body
root_cause: missing_tooling
resolution_type: code_fix
severity: high
tags: [transcript-embeddings, mastra, ai-gateway, railway]
---

# Mastra Transcript Launch Network Errors Need Upstream Diagnostics

## Problem

The production transcript embedding backfill smoke failed with `network_error`
even after direct AI Gateway probes proved the gateway could serve embedding
requests. The Admin launch client collapsed thrown fetches and non-workflow
Mastra responses into the same retryable result, so operators could not tell
whether the failure was DNS, auth, route registration, a bad upstream status, or
another handoff problem.

## Symptoms

- A one-target Admin GraphQL trigger returned HTTP 200 but reported the target
  as failed with reason `network_error`.
- Direct production probes from the Mastra environment to `/v1/models` and
  `/v1/embeddings` returned healthy responses.
- Mastra route logs did not show a matching transcript embedding request.
- The Admin workflow emitted target failure logs, but the launch client did not
  preserve thrown fetch messages or non-OK response details.

## What Didn't Work

- Treating `network_error` as proof that AI Gateway was down did not hold once
  direct model and embedding probes succeeded.
- Retrying the broad backfill would have been noisy and potentially expensive
  because the single-target smoke still failed through the same opaque launch
  path.
- Checking only service-level Railway health was not enough: Admin, Admin
  worker, Mastra, and AI Gateway could all be online while the Admin to Mastra
  launch contract still failed.

## Solution

Add structured diagnostics at the Admin launch boundary in
`apps/admin/src/services/mastra-transcript-embedding-client.ts`:

```ts
try {
  response = await fetch(endpoint, request)
} catch (error) {
  console.error(
    JSON.stringify({
      event: "mastra_transcript_embedding_launch_threw",
      name: error instanceof Error ? error.name : "unknown",
      message:
        error instanceof Error
          ? error.message.slice(0, 240)
          : String(error).slice(0, 240),
    }),
  )
  return { ok: false, reason: "network_error", retryable: true }
}
```

Read the response body once, parse it as a workflow result when possible, and
log a short status/body prefix when Mastra returns a non-workflow non-OK
response:

```ts
const responseBody = await response.text().catch(() => undefined)
const result = parseWorkflowResult(parseJsonBody(responseBody))
if (result) return result

if (!response.ok) {
  logMastraLaunchFailure({
    status: response.status,
    statusText: response.statusText,
    contentType: response.headers.get("content-type"),
    body: responseBody,
  })
  return { ok: false, reason: "network_error", retryable: true }
}
```

The runtime result semantics stay unchanged: callers still receive
`network_error`, `auth_failed`, or `parse_error` as before. The difference is
that production logs now preserve enough upstream context to decide the next
fix.

## Why This Works

The embedding system has multiple health boundaries. AI Gateway health proves
the provider can embed text; it does not prove Admin can launch a Mastra
transcript embedding workflow. Logging the launch boundary separates provider
health from route/auth/network failures between Admin and Mastra.

Keeping the caller-facing result stable avoids changing retry behavior during a
production incident, while preserving the upstream failure details needed to
debug safely.

## Prevention

- Before retrying a full transcript embedding backfill, prove the smallest
  representative target works end to end.
- When direct AI Gateway probes are green but Admin still reports
  `network_error`, inspect Admin to Mastra launch diagnostics instead of
  assuming the provider is down.
- Keep broad backfill retries behind a one-target smoke until logs show the
  launch request reaches Mastra and the workflow returns a typed result.

## Related Issues

- PR #1319: `fix(admin): log Mastra transcript launch failures`
- `docs/solutions/runtime-errors/useworkflow-nested-group-step-event-log-corruption.md`
- `docs/solutions/architecture-patterns/provider-bound-content-embedding-backfill-gate-pattern.md`
