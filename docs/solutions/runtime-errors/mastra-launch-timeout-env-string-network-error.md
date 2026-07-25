---
title: Mastra launch timeout env strings caused instant network errors
date: 2026-06-19
category: runtime-errors
module: apps/admin Mastra embedding launch clients
problem_type: runtime_error
component: service_object
symptoms:
  - Transcript embedding launch failed in about 1ms with reason network_error
  - Admin diagnostics logged TypeError delay argument must be number
  - Production env contained a numeric timeout value as a string
root_cause: config_error
resolution_type: code_fix
severity: high
tags: [mastra, transcript-embeddings, env, timeout]
---

# Mastra Launch Timeout Env Strings Caused Instant Network Errors

## Problem

The production transcript embedding smoke still failed after AI Gateway health
was proven and Admin launch diagnostics were deployed. The new diagnostics
showed the actual throw happened before any Mastra request was sent:
`AbortSignal.timeout` received the string value `"1200000"` instead of a
number.

## Symptoms

- The workflow report showed `reason: "network_error"` for the target.
- The per-target duration was about 1ms, so the request was not waiting on a
  long AI Gateway embedding call.
- Admin logs emitted `mastra_transcript_embedding_launch_threw` with
  `TypeError: The "delay" argument must be of type number`.

## What Didn't Work

- Changing production env values alone would not address the class of bug:
  Node env vars are strings, and some runtime paths can still surface string
  values even when schema definitions use numeric coercion.
- Continuing the full backfill would have repeated the same instant failure
  for every target.

## Solution

Normalize timeout values at the Admin to Mastra launch boundary before passing
them into `AbortSignal.timeout`.

```ts
export function resolveMastraLaunchTimeoutMs(
  value: number | string | undefined,
  fallbackMs = 120_000,
): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isInteger(parsed) && parsed > 0) return parsed
  }

  return fallbackMs
}
```

Use that resolver in the transcript, scene, and experience Admin launch
clients so all Mastra embedding launchers tolerate numeric env strings.

## Why This Works

`AbortSignal.timeout` validates its `delay` argument at call time. If a runtime
env value reaches it as a string, the function throws synchronously and the
launch client reports a retryable network error without opening a network
connection. Coercing at the call boundary converts valid numeric env strings
and falls back safely for invalid values.

## Prevention

- Treat env-derived timeout and delay values as untrusted at the boundary where
  they enter Node timer APIs.
- Add regression tests for production-shaped numeric strings, not only typed
  number inputs.
- When a target fails in 1-2ms, inspect synchronous client setup before blaming
  the downstream provider.

## Related Issues

- PR #1320: `fix(admin): normalize Mastra launch timeout env values`
- `docs/solutions/runtime-errors/mastra-transcript-launch-network-error-diagnostics.md`
