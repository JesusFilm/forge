---
id: "feat-294"
title: "Branded ValidatedBaseUrl input for the shared Mastra transport"
owner: "jian wei"
priority: "P3"
status: "not-started"
start_date: "2026-07-27"
duration: 1
depends_on:
  - "feat-282"
blocks: []
tags:
  - "web"
---

## Problem

feat-282's shared transport left the base-SSRF guard (`hostAllowed`) coupled to
the shared fetch helper (`postMastraUpstream`) only by a JSDoc convention
("callers run `hostAllowed` on the base BEFORE this"). The helper's origin pin
closes only the path-escapes-the-base gap: a future caller that skips the guard
and passes a self-consistent hostile base (`baseUrl: "http://evil.example"`,
`path: "/x"`) passes the pin vacuously and egresses the `AI_CHAT_MASTRA_API_KEY`
bearer in cleartext. Today's two callers both run the guard, so this is a latent
future-caller hazard, not a live bug — recorded as a known scope limit in the
compound doc below. The fix makes skipping the guard a compile error instead of
a convention.

## Entry Points — Read These First

1. `docs/solutions/best-practices/guard-then-use-extraction-act-half-pins-invariant-20260722.md`
   — "Scope and limits of the pin" and the branded-type paragraph are this
   ticket's spec; the per-proxy-deny rationale there is binding.
2. `apps/chat/src/lib/server/mastra-upstream.ts` — `hostAllowed`,
   `MastraUpstreamRequest.baseUrl`, `postMastraUpstream` (keep its origin pin —
   it guards an independent invariant).
3. `apps/chat/src/app/api/seeker/route.ts` — the `hostAllowed` →
   `ssrf_blocked` branch and the `postMastraUpstream` call it guards.
4. `apps/chat/src/app/api/history/history-proxy.ts` — `forwardHistoryRequest`'s
   `hostAllowed` → 502 `unavailable` branch and its call.

## Grep These

- `hostAllowed` — the guard and both call sites
- `postMastraUpstream` / `MastraUpstreamRequest` — the input type to brand
- `ssrf_blocked` — the seeker deny wire that must stay at the call site
- `ValidatedBaseUrl` — must not exist yet

## What To Build

In `mastra-upstream.ts`:

```ts
declare const validatedBaseUrlBrand: unique symbol
export type ValidatedBaseUrl = string & {
  readonly [validatedBaseUrlBrand]: true
}

/** Mints the branded base iff hostAllowed passes; null otherwise. The ONLY
 * production source of ValidatedBaseUrl — no casts anywhere else. */
export function validateBaseUrl(
  baseUrl: string,
  allowedHostsCsv: string | undefined,
): ValidatedBaseUrl | null
```

- Change `MastraUpstreamRequest.baseUrl` to `ValidatedBaseUrl`. `hostAllowed`
  stays exported and unchanged (its SSRF matrix suite must not change).
- Each proxy replaces its boolean `hostAllowed` check with `validateBaseUrl`;
  `null` maps to the SAME per-proxy deny as today (seeker `ssrf_blocked`
  frame; history 502 `unavailable`), and the branded value threads into
  `postMastraUpstream`.
- Tests: `validateBaseUrl` mint/null unit tests beside the SSRF matrix; a
  `@ts-expect-error` pin proving a raw string no longer compiles as
  `MastraUpstreamRequest.baseUrl`; `postMastraUpstream` unit tests mint via
  `validateBaseUrl` (no `as ValidatedBaseUrl` casts in production code; test
  code prefers minting too).
- Docs: one-line update to the `lib/server/mastra-upstream.ts` entry in
  `apps/chat/CLAUDE.md`; append a dated shipped-note to the compound doc's
  "Scope and limits" section (the type-level fix it names has landed).

## Constraints

- Zero wire-behavior change. Deny ladders, budgets, response channels stay
  per-proxy (feat-282 Ruling 2 boundary — do not fold the deny into shared
  code).
- The two proxy test suites pass UNMODIFIED (validation happens inside the
  handler cores; their injected config stays plain strings).
- Keep the origin pin in `postMastraUpstream` — it is not superseded.
- Tier-2 `/ce-code-review` before push (SSRF/bearer surface — mandatory).

## Verification

- `pnpm --filter @forge/chat test` / `typecheck` / `lint` green; confirm via
  `git diff --stat` that neither proxy test file changed.
- Falsify the compile guard once: in one proxy, bypass `validateBaseUrl` and
  pass `config.baseUrl` directly → `typecheck` must fail; restore.
- Grep `as ValidatedBaseUrl` → only inside `validateBaseUrl`'s implementation.
