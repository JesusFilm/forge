---
title: "Strapi v5: Custom Error subclasses lose extensions — use GraphQLError directly"
date: 2026-04-13
problem_type: integration_issue
component: integration
root_cause: wrong_api
resolution_type: code_fix
severity: high
module: apps/cms
tags:
  - cms
  - strapi-v5
  - graphql
  - error-handling
  - rate-limiting
  - semantic-search
  - agent-api
related_files:
  - apps/cms/src/graphql/search.ts
  - apps/cms/src/graphql/search.test.ts
  - apps/cms/src/lib/rate-limit-bucket.ts
  - apps/cms/src/lib/rate-limit-bucket.test.ts
upstream_issues:
  - "@strapi/plugin-graphql formatGraphqlError catch-all in dist/server/format-graphql-error.mjs"
github_prs:
  - "#747"
---

## Problem

Custom error classes thrown from Strapi v5 GraphQL resolvers lose their `extensions` property — the client receives a generic `"Internal Server Error"` with code `INTERNAL_SERVER_ERROR` instead of the intended machine-readable error code and metadata. Resolver-level unit tests pass, but the bug ships undetected because the tests bypass Strapi's Apollo Server error formatting pipeline.

> **Still applies after the Strapi retirement (2026-07-23).** Strapi is gone, but
> this is a GraphQL-server behaviour, not a Strapi one, and admin reproduces it
> today: `WatchSearchValidationError extends Error`
> (`apps/admin/src/services/watch-search.service.ts:197`) is thrown from the
> `watchSearch` resolver path (`:246`, `:273`) carrying no `extensions`, so
> graphql-yoga masks it to `INTERNAL_SERVER_ERROR`. A mobile client branching on
> `extensions.code` therefore never matches, which is exactly how
> `parseSearchError` in apps/mobile ended up with three unreachable branches.
> Read the lesson as backend-agnostic; ignore the Strapi-specific mechanics.

## Symptoms

**Expected response** (agents can branch on `extensions.code` and back off using `retryAfterSeconds`):

```json
{
  "errors": [
    {
      "message": "Too many requests. Please try again later.",
      "extensions": {
        "code": "RATE_LIMITED",
        "retryAfterSeconds": 12
      }
    }
  ]
}
```

**Actual response** (agents can't tell rate limiting from any other internal error):

```json
{
  "errors": [
    {
      "message": "Internal Server Error",
      "extensions": {
        "code": "INTERNAL_SERVER_ERROR"
      }
    }
  ]
}
```

The server logs the original error via `strapi.log.error(originalError)`, so the real message shows up in Railway logs, but the client never sees it. Client-side retry logic, user-facing messages, and rate-limit backoff all break silently.

## What Didn't Work

- **Plain `Error` subclass with an `.extensions` property.** A custom `RateLimitError extends Error` with `.extensions` set in the constructor compiles, runs, and looks correct when caught in isolation. But `@strapi/plugin-graphql`'s `formatGraphqlError` function does not recognize it. Any error that is not a `GraphQLError` instance or one of Strapi's built-in error classes (`ForbiddenError`, `UnauthorizedError`, `ValidationError`, `ApplicationError`, `HttpError`) falls through to a catch-all that replaces the error entirely with `"Internal Server Error"`. Custom properties are discarded.

- **Unit tests that inspect the thrown object at the resolver level.** Vitest assertions like `expect(caught.extensions).toEqual({ code: "RATE_LIMITED", retryAfterSeconds: 12 })` pass because they test the resolver function in isolation, _before_ Strapi's error formatting pipeline runs. These tests validated that the resolver _throws_ the right object, but not that the object _survives_ the Apollo Server middleware. This is necessary but not sufficient coverage.

## Solution

Replace all custom error classes with `GraphQLError` from the `graphql` package.

**Before (broken):**

```ts
class RateLimitError extends Error {
  extensions: { code: "RATE_LIMITED"; retryAfterSeconds: number }
  constructor(retryAfterSeconds: number) {
    super("Too many requests. Please try again later.")
    this.name = "RateLimitError"
    this.extensions = { code: "RATE_LIMITED", retryAfterSeconds }
  }
}

// In resolver:
throw new RateLimitError(retryAfterSeconds)
```

**After (working):**

```ts
import { GraphQLError } from "graphql"

// Rate limiting
throw new GraphQLError("Too many requests. Please try again later.", {
  extensions: {
    code: "RATE_LIMITED",
    retryAfterSeconds: rateLimit.retryAfterSeconds,
  },
})

// Validation
throw new GraphQLError("query must not be empty", {
  extensions: { code: "BAD_USER_INPUT" },
})

// Upstream service failure
throw new GraphQLError("Search is temporarily unavailable", {
  extensions: { code: "SERVICE_UNAVAILABLE" },
})
```

If multiple resolvers need structured errors, a small helper keeps the call sites consistent:

```ts
import { GraphQLError } from "graphql"

function throwGraphQL(
  message: string,
  code: string,
  extra?: Record<string, unknown>,
): never {
  throw new GraphQLError(message, {
    extensions: { code, ...extra },
  })
}

// Usage:
throwGraphQL("Too many requests", "RATE_LIMITED", { retryAfterSeconds: 12 })
```

## Why This Works

Strapi's `@strapi/plugin-graphql` defines a `formatGraphqlError` function (in `format-graphql-error.mjs` at `@strapi/plugin-graphql@5.36.0`) that processes every error thrown from a resolver. The logic, in order:

1. Unwrap the resolver error via `errors.unwrapResolverError(error)` to get the original thrown object.
2. Check if the error is an `instanceof graphql.GraphQLError`. If yes, **return `formattedError` unchanged** — all extensions are preserved as-is.
3. Check if the error is an instance of a Strapi built-in error class (`ForbiddenError`, `UnauthorizedError`, `ValidationError`, `ApplicationError`, `HttpError`). If yes, serialize it using Strapi conventions.
4. **Catch-all for everything else**: log the original error, then return `createFormattedError(new graphql.GraphQLError('Internal Server Error'), 'Internal Server Error', 'INTERNAL_SERVER_ERROR', originalError)`. This replaces the error completely. Any `.extensions`, `.message`, or custom properties on the original error are lost.

Because `GraphQLError` is checked at step 2 — before the catch-all — its extensions survive the formatting pipeline intact. graphql-js v16 then serializes them into the standard `errors[].extensions` path in the JSON response body.

The `instanceof` check means the `GraphQLError` must come from the same `graphql` package instance that Strapi loads. Node resolves the hoisted singleton from `node_modules`, so this works as long as the repo has a single `graphql` version. Watch for this if two copies of `graphql` ever end up in the tree (e.g., version mismatch from a dependency upgrade) — the `instanceof` will silently fail and extensions will start getting stripped again.

## Prevention

**Always use `GraphQLError` from the `graphql` package** when throwing from a Strapi v5 custom resolver that needs machine-readable error codes or metadata in the response. Never create custom `Error` subclasses with an `.extensions` property — Strapi will silently discard them.

**Add `graphql` as a direct dependency** in `apps/cms/package.json` even though it is already a transitive dependency via `@strapi/plugin-graphql`. This makes the import obvious, keeps the version pinnable to a known-good range, and prevents confusion about where `GraphQLError` comes from:

```bash
pnpm --filter @forge/cms add graphql
```

**Resolver-level unit tests are necessary but not sufficient.** Tests that inspect the thrown error object verify your code logic but bypass Strapi's Apollo Server error formatting. To confirm extensions actually reach the client, run a smoke test against the live `/graphql` endpoint:

```bash
# Trigger the validation error
curl -s -X POST http://localhost:1337/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ semanticSearch(query: \"   \", locale: \"en\") { hasMore } }"}' \
  | jq '.errors[0].extensions.code'
# Expected: "BAD_USER_INPUT"   (not "INTERNAL_SERVER_ERROR")
```

Assert that `extensions.code` matches the expected value. This is the only test that verifies the full pipeline.

**Use standard Apollo error codes where applicable:**

| Code                  | When to use                                                  |
| --------------------- | ------------------------------------------------------------ |
| `BAD_USER_INPUT`      | Validation failures (empty query, invalid params)            |
| `UNAUTHENTICATED`     | Missing or invalid auth token                                |
| `FORBIDDEN`           | Valid auth but insufficient permissions                      |
| `SERVICE_UNAVAILABLE` | Upstream dependency down (pgvector, external API)            |
| `RATE_LIMITED`        | Custom — client should read `retryAfterSeconds` and back off |

Custom codes like `RATE_LIMITED` are encouraged when they carry actionable metadata. Document them in the resolver's JSDoc or the feature ticket so consuming apps know what to expect.

## Related Documentation

- [pgvector recommendation query + GraphQL in Strapi v5](../best-practices/pgvector-recommendation-query-locale-graphql-strapi-v5.md) — the custom GraphQL resolver pattern in Strapi v5 using `extensionService.use()` in `register()`. The resolver error handling in that doc is exactly where this fix applies.
- [Strapi v5 populate role sanitization](../cms/strapi-v5-populate-role-sanitization.md) — another case of Strapi v5 silently stripping developer-provided data (content API sanitization).
- [Codegen strips optional GraphQL variables](../cms/codegen-strips-optional-graphql-variables.md) — same class of bug: tooling silently removes GraphQL metadata the developer explicitly provided.
- [Strapi nested relation truncation and N+1](../performance-issues/strapi-nested-relation-truncation-and-n-plus-one-manager-20260328.md) — another investigation of `@strapi/plugin-graphql` internal behavior.
- [feat-010 Semantic Search API](../../roadmap/content-discovery/feat-010-semantic-search-api.md) — the feature ticket that defines the `errors[].extensions.code` contract this fix enables.
- PR #747 — the PR where this was diagnosed and fixed during a multi-pass `ce:review` loop.
- [Next.js Server Action + LLM structured output with defense-in-depth validation](../best-practices/nextjs-server-action-llm-structured-output-pattern-2026-04-21.md) — downstream consumer example of this error contract. The `/demo-search` Server Action reads `extensions.code` from the Apollo client's `graphQLErrors` to branch on `BAD_USER_INPUT` / `RATE_LIMITED` / `SERVICE_UNAVAILABLE`, and adds its own typed `ExperienceGeneratorError` + discriminated-union return for LLM failures. PR #809's `fetchWithRetry` helper also honors `retryAfterSeconds` as `Retry-After` on 429 responses when chained to OpenRouter — consistent with this doc's rate-limit contract.
