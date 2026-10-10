---
title: Next.js Server Action thrown errors lose typed-message discrimination in production builds
date: 2026-04-30
tags: [nextjs, server-actions, error-handling, production-build, react]
category: best-practices
severity: medium
---

## Problem

A "use server" function that throws `new Error("typed_code_string")`
to signal failure modes works in dev/test but **silently degrades**
in production builds. Next.js redacts the thrown `Error.message`
before it reaches the client, replacing it with a generic:

```
An error occurred in the Server Components render. The specific
message is omitted in production builds to avoid leaking sensitive
details. A digest property is included on this error instance which
may provide additional details about the nature of the error.
```

Client code that branches on `error.message === "<typed_code>"`
will silently skip the typed branch and fall through to the
generic-error path. A user-experience designed around two distinct
error states (e.g., "service not configured" muted banner vs.
"upstream failure" red banner) collapses to always rendering the
generic-failure branch in prod.

## Symptoms

- Works perfectly in `next dev` and unit tests with mocked thrown errors
- In production deploys, the "typed" error UI branch never fires
- Server-side logs show the thrown typed error correctly:
  `⨯ Error: typed_code_string`
- Client-side `error.message` is the redacted generic string + a `digest` field
- The error's `digest` is opaque (an integer-string hash) — useful only
  for cross-referencing server logs, not for branching client logic

## What Didn't Work

- **Catching `cause` chain client-side** — `Error.cause` is also
  redacted; only `digest` survives.
- **Subclassing the Error** — class identity is lost across the
  serialization boundary. The instance arriving on the client is a
  generic `Error`, not the subclass.
- **Disabling sourcemaps / minification** — orthogonal; redaction is
  controlled by Next's prod build flag, not by minification.
- **Reading `error.digest` against a server-logged map** — works but
  fragile (race between client mount and log backend) and adds
  observability infrastructure for what should be a single function call.

## Solution

**Return a discriminated union from the server action instead of
throwing.** Return values traverse Next's serialization path
(`flight-server-edge` → client) which is **not** redacted; only
thrown errors are.

Before:

```ts
"use server"
export async function searchAlgolia(args): Promise<{ hits: Hit[] }> {
  if (!env.ALGOLIA_APP_ID || !env.ALGOLIA_SEARCH_API_KEY) {
    throw new Error("algolia_not_configured")
  }
  const response = await fetch(...)
  if (!response.ok) {
    throw new Error("algolia_upstream_error")
  }
  return { hits: parse(response) }
}
```

After:

```ts
"use server"
type AlgoliaResult =
  | { ok: true; hits: Hit[] }
  | { ok: false; code: "not_configured" | "upstream_error"; detail?: string }

export async function searchAlgolia(args): Promise<AlgoliaResult> {
  if (!env.ALGOLIA_APP_ID || !env.ALGOLIA_SEARCH_API_KEY) {
    return { ok: false, code: "not_configured" }
  }
  const response = await fetch(...)
  if (!response.ok) {
    return { ok: false, code: "upstream_error", detail: `status=${response.status}` }
  }
  return { ok: true, hits: parse(response) }
}
```

Client:

```tsx
const result = await searchAlgolia(args)
if (result.ok) {
  setPane({ status: "ok", hits: result.hits })
} else if (result.code === "not_configured") {
  setPane({ status: "not_configured" })
} else {
  setPane({ status: "error", message: result.detail })
}
```

The `code` field crosses the boundary intact — branching is
production-safe.

## Why This Works

Next.js redacts thrown errors as a defense against accidental
secret leakage (e.g., a stack trace exposing internal hostnames,
DB connection strings, or auth tokens). The redaction is unconditional
on `Error.message` regardless of whether the thrown content is
sensitive — Next can't distinguish.

Return values are presumed-intentional output: the developer chose
what to serialize, so Next does not strip it. A discriminated union
treats failure as a normal return shape, opting out of the redaction
path entirely.

This is consistent with the broader React Server Components / Server
Actions design philosophy: **errors are for unexpected conditions
that should bubble to the nearest error boundary**; expected failure
modes (validation rejection, upstream-not-configured, soft 4xx) are
return values.

## Prevention

1. **Default to discriminated-union return types** in every new
   server action. Reach for `throw` only when the failure is genuinely
   unrecoverable and the page should render an error boundary.
2. **Add an integration test that runs against a `next build`
   production bundle**, not just `next dev` — the redaction only
   manifests in production. A vitest run will not catch this.
3. **Lint rule candidate**: flag `throw new Error("<lowercase_snake_case>")`
   inside files starting with `"use server"` — the snake_case shape
   is a tell that someone is encoding a typed error code in
   `Error.message`. Suggest the discriminated-union refactor.
4. **Document in the action's JSDoc**: if a server action does throw,
   call out that callers can branch on `digest` (with a server-log
   correlation) but **not** on `message` in production.

### Test scaffold

```ts
// nextjs-server-action.prod.spec.ts — runs against next build output
test("server action returns typed code, not thrown error", async () => {
  const result = await searchAlgolia({ q: "x", locale: "en", limit: 5 })
  expect(result.ok).toBe(false)
  expect(result.code).toBe("not_configured")
  // NOT: expect(() => searchAlgolia(...)).rejects.toThrow("not_configured")
})
```

## Where this bit us

PR #864 (admin Algolia parity column on `/watch/demo-keyword-search`,
merged 2026-04-30). The demo client mapped:

```ts
if (message === "algolia_not_configured") {
  return { status: "not_configured" }
}
return { status: "error", messages: message.split("; ") }
```

In dev this rendered the muted "Algolia disabled" banner correctly.
In production, when env vars hadn't propagated through the Railway
staged-patch trap, the same code path showed the loud red
"Algolia upstream error" banner with the redacted generic text.
The muted-banner UX was effectively dead code in prod.

## Related

- [Server Actions docs](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations)
- `apps/admin/src/app/watch/demo-keyword-search/algolia-action.ts`
  (the throwaway harness that surfaced the lesson — slated for
  removal at R8 cutover; the discriminated-union refactor should
  land before then in any case)
- `docs/solutions/platform/railway-mcp-staged-config-never-commits-20260420.md`
  — the env-var staged-patch trap that triggered the unconfigured
  state we observed live
- `docs/solutions/best-practices/nextjs-server-action-llm-structured-output-pattern-2026-04-21.md`
  — sibling pattern using discriminated-union outputs from server
  actions for LLM responses
