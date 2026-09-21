---
title: "Validate the RESOLVED path, not the raw string: dot segments walked an authored Watch tile onto the session-clearing logout GET"
date: 2026-09-10
category: security-issues
module: packages/watch-url-policy
problem_type: security_issue
component: service_object
symptoms:
  - "An authored tile destination of `/./api/auth/logout` passed the classifier's `/api` rejection because the literal prefix test ran on the raw string, and the browser then resolved it onto `/watch/api/auth/logout`."
  - "Percent-encoded dot segments (`/%2e/api/...`, `/%2E/api/...`, `/%2e%2e/watch/api/...`) survived both the `..` traversal regex and the `/api` prefix test."
  - "A query string alone defeated the equality arm of the API check: `/api?x=1` is neither `/api` nor `/api/`-prefixed."
  - "Stripping the base path off `/watch//api/auth/logout` produced `//api/auth/logout` — the protocol-relative shape the same function rejects a few lines earlier on raw input."
  - "The same PR removed `prefetch={false}` from the rail's links, so the browser would issue the resulting request with no click at all."
root_cause: missing_validation
resolution_type: code_fix
severity: high
framework_version: "next 16.2.4, node 26.8.1"
related_components:
  - packages/watch-url-policy/src/watch-home-tiles.ts
  - apps/web/src/components/home/WatchHomeCategoryRail.tsx
  - apps/web/src/lib/watch-home-tiles.ts
  - apps/admin/src/domain/blocks.ts
  - apps/web/src/app/api/auth/logout/route.ts
related:
  - docs/solutions/architecture-patterns/widening-a-closed-selection-block-into-an-authored-list-20260827.md
  - docs/solutions/security-issues/invisible-character-class-gap-defeats-url-redaction.md
  - docs/solutions/security-issues/ssrf-defense-streaming-proxy-and-codeql-fp-20260504.md
  - docs/solutions/workflow-issues/ce-code-review-tier-2-mandatory-before-push-20260511.md
tags:
  - url-validation
  - path-traversal
  - open-redirect
  - prefetch
  - authored-content
  - watch
  - defense-in-depth
---

# Validate the RESOLVED path, not the raw string

## Problem

`classifyWatchHomeTileHref` (`packages/watch-url-policy/src/watch-home-tiles.ts:271`) is the single gate on destinations an admin types into a Watch homepage category tile. It runs at the admin write boundary (`apps/admin/src/domain/blocks.ts:488`, via `isSafeWatchHomeTileHref`; also `apps/admin/src/app/dashboard/experiences/experience-editor/watch-home-category-rail-tiles.ts:206`) and again at render (`apps/web/src/lib/watch-home-tiles.ts:131`), because the block JSON is MCP-writable and outlives any one validator.

Its two most load-bearing rejections — the `..` traversal regex (`watch-home-tiles.ts:244`) and the `/api` denial — ran against the RAW authored string. The value that actually takes effect is the one the browser produces after it normalizes dot segments and percent-decodes them. Those are different values, and the guard was inspecting the wrong one.

Measured against the probe origin the fixed code now uses (node 26.8.1 WHATWG `URL`):

| authored                        | resolves to              |
| ------------------------------- | ------------------------ |
| `/./api/auth/logout`            | `/api/auth/logout`       |
| `/%2e/api/auth/logout`          | `/api/auth/logout`       |
| `/%2E/api/auth/logout`          | `/api/auth/logout`       |
| `/foo/%2e%2e/api/auth/logout`   | `/api/auth/logout`       |
| `/%2e%2e/watch/api/auth/logout` | `/watch/api/auth/logout` |
| `/watch/./api/auth/logout`      | `/watch/api/auth/logout` |
| `/api?x=1`                      | `/api?x=1`               |

Every one of those was ACCEPTED and classified `kind: "watch"`. apps/web is served under `basePath: WATCH_BASE_PATH` (`apps/web/next.config.mjs:68`, `/watch` per `packages/watch-url-policy/src/routes.ts:8`), and `next/link` prepends that base path itself, so each of them lands on `https://www.jesusfilm.org/watch/api/auth/logout`. That route exports a `GET` (`apps/web/src/app/api/auth/logout/route.ts:21`) which deletes the session, state, verifier and return-to cookies and plants a force-login cookie (`:35-45`). A broken-link-class bug and a log-the-viewer-out bug are the same bug here; only the resolved path tells them apart.

What raised the severity was arriving in the same PR as the prefetch change. The change that made Watch cards client-side navigations (PR #2244) also removed `prefetch={false}` from the category rail's `next/link` (`apps/web/src/components/home/WatchHomeCategoryRail.tsx:244-257` now carries no `prefetch` prop, i.e. Next's default viewport-eligible prefetch). Its own commit message states the reasoning explicitly — "a Watch tile is prefetchable, so a side-effecting GET must not be reachable that way. That gate is what makes eager prefetch on the category rail safe." The gate it was relying on was the one with the hole. No click required: rendering the rail is enough.

The second, distinct bug lives in the same function. The base-path strip was applied to the raw string, so `/watch//api/auth/logout` became `//api/auth/logout` — the protocol-relative shape rejected on raw input a few lines earlier (`watch-home-tiles.ts:283`). The strip MANUFACTURED the forbidden shape after the check that forbids it. This one is worth naming separately because URL-parser normalization does not fix it: an empty path segment survives parsing intact (`/watch//api/x` → pathname `/watch//api/x`). The two bugs need two different fixes.

## Symptoms

- No error, no failing test, no type error. An admin-authored tile rendered as an ordinary category card whose destination happened to be a session-clearing GET.
- 3,900+ existing apps/web unit tests, `tsc`, ESLint and a full `next build` were all green across both bugs.
- The classifier's return value looked correct in every case. `classifyWatchHomeTileHref("/./api/auth/logout")` returned `{ kind: "watch", href: "/./api/auth/logout" }` — a string that reads as an in-app path.

## What Didn't Work

**Asserting on the classifier's return value.** This is the core reason the class survived review-by-reading and a large unit suite. The returned `href` for every bypass is a plausible-looking Watch path; the defect is only visible one resolution step later, in a component the classifier does not own. A test of the form `expect(classify(x)).toEqual({ kind: "watch", href: "/./api/..." })` documents the bug as intended behavior.

**A denylist of the forbidden path.** `relative === "/api" || relative.startsWith("/api/")` enumerates spellings of one destination. Dot segments, percent-encoding, empty segments and a bare query string are four ways to spell the same destination differently; the parser knows all of them and a prefix test knows none. (The residual below covers what remains after the fix.)

**A prior, correct, partial validator reading as complete.** The destination policy already had a compounded learning behind it — `docs/solutions/architecture-patterns/widening-a-closed-selection-block-into-an-authored-list-20260827.md` covers `javascript:`/`data:`/`vbscript:`, `//host`, `http:` downgrade and control characters, and all of those checks were present and correct (control characters, backslash and `//` at `watch-home-tiles.ts:280-283`; the scheme rejection at `:333`). The presence of a thoughtful, documented validator is what made the missing axis invisible: reviewers checked that the known rules were implemented, not that the rule set was closed over how a browser reads a path.

## Solution

The order in the current code is the whole fix (`watch-home-tiles.ts:285-324`):

1. Resolve first, check after. `new URL(href, DESTINATION_PROBE_ORIGIN)` before any path-shape test, so dot segments collapse the way the browser will.
2. The probe origin is `https://watch.invalid` (`:249`). A `.invalid` TLD is guaranteed unresolvable by RFC 6761, so if the stand-in ever leaks into a rendered href the navigation fails loudly instead of going somewhere. Pair it with an origin equality check (`:299`) — that also catches inputs the parser walks off-origin, and is a belt over the raw backslash reject at `:281`.
3. Reject a pathname containing `//` (`:306`) BEFORE the strip. Parsing does not collapse an empty segment, so this is the only thing standing between `/watch//api/x` and a manufactured `//api/x`.
4. Strip the base path from the RESOLVED pathname (`:310-315`), whole leading segment only, so `/watchlist` keeps its name.
5. Re-apply the protocol-relative rule AFTER the strip (`:320`). The raw-input check at `:283` no longer covers the post-strip value; the same rule has to hold on both sides of any transform that can reintroduce the shape.
6. Carry `search` and `hash` through from the parse (`:323`), which is also why `/watch?t=1` and `/watch#x` now strip correctly instead of missing the strip entirely.

The raw `..` regex stays at `:286` as a cheap early reject; it is no longer the thing preventing traversal.

### The test shape is the transferable part

The individual bypass cases are worth having (`watch-home-tiles.test.ts:239-256`), but they only ever cover the spellings someone thought of. The durable form is a property assertion over every accepted destination — resolve it the way the browser will, then assert on THAT (`watch-home-tiles.test.ts:284-309`):

```ts
const result = classifyWatchHomeTileHref(candidate)
if (result?.kind !== "watch") continue
const { pathname } = new URL(
  `/watch${result.href}`,
  "https://www.jesusfilm.org",
)
expect(pathname, candidate).toMatch(/^\/watch(\/|$)/)
expect(pathname, candidate).not.toMatch(/^\/watch\/api(\/|$)/)
```

Two properties make it durable where the case list is not. It reconstructs the CONSUMER's step (`next/link`'s base-path prepend) inside the test, so it asserts on the value that takes effect rather than the value the function returns. And it is skip-on-reject (`continue`), so adding a candidate can only ever tighten it — a new bypass spelling either gets rejected or must satisfy the invariant.

Falsification, measured 2026-09-10: reverting the resolve-first block (running the `/api` and strip checks against the raw `href` instead of `resolved.pathname`) and running `pnpm --filter @forge/watch-url-policy exec vitest run src/watch-home-tiles.test.ts` turns **10 of 54 tests red** — the 7 dot-segment cases, the manufactured-protocol-relative case, the property test, and the query/hash test (that last one is a correctness sibling, not a security assertion). The property test alone catches the whole class.

## Why This Works

A validator and its consumer disagree about what a string means unless the validator performs the consumer's normalization itself. `URL` is the same specification the browser implements, so resolving through it removes the disagreement rather than trying to enumerate it. Everything after step 1 operates on a value that has already been through the transform the attacker was exploiting.

Steps 3 and 5 are a different law and worth separating in your head: any transform the validator performs AFTER a check (here, the base-path strip) can reintroduce a shape the check forbade. Either check again after the transform, or make the transform incapable of producing the shape. This one does both — reject `//` in the input to the strip, and re-check the output of it.

## Prevention

**The general rule.** Any guard that inspects a path, URL, filename, or similar string BEFORE a consumer normalizes it is validating a different value than the one that takes effect. Applies well beyond this function: filesystem path checks before `path.resolve`, host checks before `URL` parsing, extension checks before decoding, allowlists compared against a string the framework will canonicalize. Do the consumer's normalization inside the validator, then check.

**Reconstruct the consumer's step in the test.** Where a validator's output is handed to something that transforms it again (`next/link` prepending a base path, a router, a `path.join`), the assertion belongs on the post-transform value. A test that stops at the validator's return value cannot see this class of defect no matter how many cases it enumerates.

**Watch for a security-relevant default flipping in the same change.** Removing `prefetch={false}` converted "an admin can author a bad link someone might click" into "rendering the page fires the request." A guard that was adequate under one interaction model is not automatically adequate under the other; when a diff removes a `prefetch`, `preload`, `eager`, autoplay or auto-submit brake, re-derive what the guards downstream of it were assuming.

**A documented partial validator still needs the closure question asked.** The prior learning made the existing checks look complete. When reviewing an authored-input policy, ask "what is the set of ways this input can be spelled" rather than "are the documented rules implemented."

### Residual, accepted

The `/api` rule is still a denylist of one subtree (`watch-home-tiles.ts:317`). An allowlist of admitted shapes would be stronger, and the repo already has a broader inventory of non-viewer-facing first segments — `PUBLIC_WATCH_RESERVED_FIRST_SEGMENTS` in `packages/watch-url-policy/src/routes.ts:21-39` lists `api`, `_next`, `assets`, `preview`, `.well-known` and more, and the classifier consults none of it. Those remain authorable and, on the category rail, prefetchable. The reason `/api` alone was singled out is that it is the only one of them with a side-effecting GET; the others are inert or 404. If another subtree gains a state-changing GET, this denylist is the thing that will not have been updated.

## Related Issues

- Caught by the security lens of `/ce-code-review`, which ran because the diff touched a URL validator. Not caught by types, lint, `next build`, or 3,900+ existing unit tests. This is the routing rule from `docs/solutions/workflow-issues/ce-code-review-tier-2-mandatory-before-push-20260511.md` earning its keep on a sensitive surface.
- Direct predecessor: `docs/solutions/architecture-patterns/widening-a-closed-selection-block-into-an-authored-list-20260827.md` — its trap (3) established the authored-destination policy (same-origin path or absolute `https:`, re-checked at render, drop rather than substitute). That guidance is correct and unchanged; this doc adds the axis it did not cover.
- Same family as the "validate the value that takes effect" instances already in the corpus: `docs/solutions/security-issues/invisible-character-class-gap-defeats-url-redaction.md` (a sanitizer's character class did not cover the spellings the matcher would see) and `docs/solutions/security-issues/ssrf-defense-streaming-proxy-and-codeql-fp-20260504.md` (Layer 2 reconstructs the URL from validated components rather than trusting the string that passed the check).
- Precision note on a neighbouring in-tree comment, measured 2026-09-10 on node 26.8.1: `watch-home-tiles.ts:241-243` and `watch-home-tiles.test.ts:228-229` say a backslash makes `/watch\evil.example` resolve cross-origin. It does not — that input resolves to `https://watch.invalid/watch/evil.example`. The cross-origin case is a backslash in the FIRST position after the leading slash (`/\evil.example` → `https://evil.example/`, because WHATWG treats `/\` as `//`). Both inputs are correctly rejected today; only the stated mechanism is over-general. Refresh candidate for whoever next touches that comment.
