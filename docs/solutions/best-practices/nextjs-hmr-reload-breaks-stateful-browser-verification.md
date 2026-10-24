---
title: "Next.js dev server HMR reload masks client state — stateful browser verification needs next build + next start"
date: "2026-07-22"
category: best-practices
problem_type: best_practice
module: apps/chat
component: testing_framework
severity: medium
tags:
  - nextjs
  - hmr
  - dev-server
  - browser-verification
  - client-state
  - next-build
  - chrome-devtools-mcp
applies_when:
  - "Browser-verifying any behavior that must survive a server restart or swap (kill-switch flips, env allowlist rotation, credential rotation, mid-session access revocation)"
  - "Testing a persisted conversation, form, or other client state across a backend redeploy in any Next.js app in this monorepo (chat, web, admin, manager, roadmap, auth, mastra-gateway)"
  - "Running Chrome DevTools MCP or Playwright checks that restart or reconfigure the dev server mid-test"
related_components:
  - apps/web
  - apps/admin
  - apps/manager
  - apps/roadmap
  - apps/auth
  - apps/mastra-gateway
---

# Stateful cross-restart browser verification must run under `next build` + `next start`, never `next dev`

## Context

Some browser verifications hinge on **client state surviving a backend restart** — you set up an open, stateful page against one server configuration, swap the server underneath it (kill + relaunch with different env, flip a kill switch, rotate a secret/allowlist), and then, _without reloading the page_, check what the still-open tab does. The whole point is that the page keeps its in-memory state across the swap; the swap is the independent variable.

`next dev` cannot host this class of check. During feat-281 PR 2 verification (apps/chat, Next.js 16 App Router) the required matrix was a mid-session access revocation:

1. With a gate-granted, signed-in page, send one live Seeker message — this persists a server thread and marks the in-page conversation `serverPersisted`.
2. Kill **only** that chat dev server (`pnpm --filter @forge/chat dev`, port 3200).
3. Relaunch it with the **same** `CHAT_SESSION_SECRET` but a `SEEKER_ALLOWED_EMAILS` allowlist that now **excludes** the user.
4. **Without reloading the page**, send into the persisted conversation (expect the visible "Your access to Seeker has changed" notice), then into a fresh conversation (expect an immediate inline stub).

Under `next dev`, step 3 silently invalidated the whole test. The Next.js dev runtime keeps an HMR websocket open to the dev server; when the server was killed and relaunched, the browser reconnected and the dev runtime **forced a full page reload**. All client state reset — the page re-rendered as the denied shape _from scratch_, so step 4 exercised a freshly-loaded denied page (the plain stub path) instead of the surviving granted-page state the matrix was written to test. The check produced a confident-looking but meaningless "pass."

Observed signatures of the self-invalidation, from this session's verification:

- `performance.now()` read ~56 s when, given the elapsed wall-clock time across the kill/relaunch, it should have been several minutes — the page timeline had restarted at the swap.
- `performance.getEntriesByType("navigation")[0].type === "reload"` — a navigation the operator never triggered.
- The signed-in-but-denied UI shape appeared with no user-initiated reload.

(The HMR-reload-on-reconnect behavior is behavior of the Next.js dev runtime observed here, not a cited spec — but it is well-known dev-server behavior and reproduced cleanly in this matrix.)

## Guidance

**Any browser verification whose result depends on client state persisting across a server restart/swap must run against a production build — `next build` once, then `next start` per server configuration — not `next dev`.** Production mode ships no HMR websocket, so a server restart does not reach into the open tab and reload it; the page survives the swap with its in-memory state intact, which is the exact precondition the check needs.

Concretely, for the revocation matrix above (verified working this session):

```
# One build, reused across BOTH configurations
pnpm --filter @forge/chat build

# Config A: user granted — launch, do steps 1-2 in the browser.
# CHAT_SESSION_SECRET here is a freshly GENERATED, session-scoped throwaway
# (mint it per session) — never a real .env/staging/production secret; this
# whole method is local-only, never run against a deployed environment.
# Same rule for every var behind the "..." — no real credential ever goes on a
# command line (it lands in shell history and process listings); real values
# stay in the app's own env file, which the process reads at boot.
SEEKER_ALLOWED_EMAILS=agent@local CHAT_SESSION_SECRET=<same> ... \
  pnpm --filter @forge/chat start      # script: next start -p 3200

# Kill ONLY this server, then relaunch with Config B (user excluded),
# SAME CHAT_SESSION_SECRET so the open tab's cookie stays valid:
SEEKER_ALLOWED_EMAILS=someone-else@local CHAT_SESSION_SECRET=<same> ... \
  pnpm --filter @forge/chat start      # next start -p 3200 again
# Now, WITHOUT reloading, run step 4 in the still-open tab.
```

**One build serves both the granting and denying configurations** — you do not rebuild between configs. Two verified facts in the tree make this safe for this app:

- `apps/chat/src/app/page.tsx:16` — `export const dynamic = "force-dynamic"`. The page's seeker-gate resolution is **not** folded into the build-time prerender (the load-bearing comment at `page.tsx:7-15` says exactly this: without `force-dynamic`, Next.js folds the env read, the session-cookie read, and the gate resolution into the build). So nothing about the gate decision is frozen into the build output — the decision is re-evaluated on the request path.
- `apps/chat/src/config/env.ts:70` — `export const env = envSchema.parse({ ... process.env ... })`. The env is parsed at **module initialization (process boot)**, and the gate helpers (`isSeekerChatEnabled` at `env.ts:108`, `isSeekerEmailAllowed` at `env.ts:119`) read that module-level `env` constant. So a given server _process_ reflects the env it was launched with; **restarting the process re-reads `process.env` at boot**, and `force-dynamic` guarantees the newly-booted value reaches the next request instead of a cached prerender.

The composition — build-time freezing suppressed by `force-dynamic`, plus env captured fresh at each process boot — is what lets a single build serve config A, then config B after a restart, with no rebuild in between. (Note the nuance: within one running process the env is constant across requests, captured once at boot; it is the _restart_ that swaps configurations, not a per-request re-read.)

> **Scope warning — the one-build shortcut is proven for apps/chat only.** It
> holds only when the route under test is dynamic (`force-dynamic` or
> equivalent) AND the config-differentiating value is read at runtime. Before
> reusing one build in another app, re-verify both facts there: a
> `NEXT_PUBLIC_*` differentiator is **inlined at build time** (apps/web's env
> shape), and a statically-generated route (apps/roadmap uses
> `generateStaticParams`) bakes its render at build — in either case the env
> swap is a no-op against a stale build and you get exactly the
> silently-wrong green this doc exists to prevent. When in doubt, run a fresh
> `next build` per configuration; only the HMR-reload rule below is universal.

**Detection guard — assert page continuity before trusting a post-swap result.** Because the failure mode is silent (a reloaded page still renders _a_ result, just the wrong one's state), do not trust any cross-swap check without proving the tab actually survived. The sound discriminator is a `window` sentinel: stamp it before the swap; any full reload mints a fresh `window`, so the sentinel's survival IS the proof. (Do not gate on `performance.getEntriesByType("navigation")[0].type !== "reload"` — that entry describes how the _current document was originally loaded_ and never changes for the document's lifetime, so a page you F5'd during setup false-fails the check even though it survived the swap perfectly. The Context section's navigation-type observation was diagnostic evidence _after_ the reload had already happened, not a guard.)

```js
// Before the swap (in the browser, via evaluate_script):
window.__preSwap = performance.now()

// After the swap, BEFORE reading the test result:
if (window.__preSwap === undefined) {
  throw new Error(
    "page reloaded across the swap — result is invalid (next dev?)",
  )
}
```

`next dev` remains perfectly fine for **stateless** checks — anything where each page load is independent (a single render, a one-shot gate outcome, layout/visual/responsive checks, a form submit that reloads anyway). The build+start requirement is scoped strictly to checks that need state to _outlive_ a server swap.

## Why This Matters

The dangerous property is that the failure is **invisible and self-confirming**. A reloaded page does not error — it renders the denied shape correctly, the assertion for the denied shape passes, and the run reports green. Nothing surfaces the fact that the reload wiped the exact precondition (a _surviving granted-page_ conversation marked `serverPersisted`) the matrix existed to test. You do not learn that the "access changed" notice path was never exercised; you learn only that a fresh denied page shows a stub — a trivially true thing you were not trying to verify.

This is a whole class of checks, not a chat-specific quirk. Access revocation mid-session, kill-switch flips, allowlist / credential / secret rotation, and every "what does the already-open tab do when the backend changes underneath it" scenario share the same precondition (surviving client state) and the same `next dev` failure. Running any of them under `next dev` yields a confident-looking, meaningless result — the worst kind, because it will be recorded as evidence.

The fix is cheap and one-time: a single `next build`, then relaunch `next start` per configuration. Because chat's gate env is read at process boot and its request path is `force-dynamic`, the one build covers every configuration the matrix cycles through — no per-config rebuild cost (in apps where those two facts do not hold, rebuild per config; see the scope warning in Guidance).

## When to Apply

- The verification depends on **client state surviving a server restart or swap** — the page is set up under one config, the server is replaced, and the _same open tab_ (no reload) is then exercised.
- Mid-session **access revocation** matrices (grant → revoke without reload).
- **Kill-switch flips** verified against an already-open page.
- **Allowlist / credential / secret / feature-flag rotation** where you check how a live tab behaves after the value changes underneath it.
- Any "what does the open tab do when the backend changes" reliability check.
- Applies to **every Next.js app in this monorepo** — `apps/chat`, `apps/web`, `apps/admin`, `apps/manager`, `apps/roadmap`, `apps/auth`, `apps/mastra-gateway` — since all share the dev-server HMR-reload-on-reconnect behavior. (Only the HMR rule is universal; the one-build-many-configs shortcut is chat-proven — see the scope warning in Guidance.)

Do **not** reach for build+start for stateless checks — independent page loads, single-render gate outcomes, visual/layout/responsive smoke, or any flow that reloads the page anyway. `next dev` is the right, faster tool there.

## Examples

**Before — the `next dev` attempt that silently invalidates itself:**

```
# Config A (granted): start the dev server, set up the granted page, send one message.
SEEKER_ALLOWED_EMAILS=agent@local ... pnpm --filter @forge/chat dev   # next dev -p 3200
#   → browser: page granted, message sent, conversation now serverPersisted.

# Config B (revoked): kill the dev server, relaunch with the user excluded.
SEEKER_ALLOWED_EMAILS=someone-else@local ... pnpm --filter @forge/chat dev
#   → the open tab's HMR websocket reconnects and FORCES A FULL RELOAD.
#     performance.now() ≈ 56s (should be minutes); navigation type === "reload".
#   → step 4 now runs against a fresh denied page. It shows a stub (trivially true).
#     The "access changed" path for a SURVIVING persisted conversation is never tested.
#     Result: green, and meaningless.
```

**After — one build, `next start` per config, page survives the swap (verified working):**

```
pnpm --filter @forge/chat build                                    # once

# CHAT_SESSION_SECRET = freshly minted throwaway (see Guidance) — never a real one.
SEEKER_ALLOWED_EMAILS=agent@local CHAT_SESSION_SECRET=<same> ... \
  pnpm --filter @forge/chat start                                  # next start -p 3200
#   → browser: grant, send, conversation serverPersisted. Stamp the sentinel:
#     window.__preSwap = performance.now()

# Kill ONLY this server; relaunch with the user excluded, SAME secret:
SEEKER_ALLOWED_EMAILS=someone-else@local CHAT_SESSION_SECRET=<same> ... \
  pnpm --filter @forge/chat start                                  # next start -p 3200
#   → NO HMR socket in production → the open tab is untouched, state intact.

# In the still-open tab, confirm continuity, THEN run step 4:
#   window.__preSwap !== undefined                       → true  (sentinel survived → no reload)
#   → persisted conversation: "Your access to Seeker has changed" notice ✓
#   → fresh conversation: inline stub in ~25ms ✓
```

**Continuity sentinel, standalone (the guard that catches "you're accidentally on `next dev`"):**

```js
// Before the swap:
window.__preSwap = performance.now()

// After the swap, gate the whole result on this (a full reload mints a fresh
// window, wiping the sentinel — its survival IS the no-reload proof):
if (window.__preSwap === undefined) {
  throw new Error(
    "page reloaded across the swap — result is invalid (next dev?)",
  )
}
```

## Related

Code anchors:

- `apps/chat/src/app/page.tsx:16` — `export const dynamic = "force-dynamic"` (and the load-bearing comment at lines 7-15 explaining the build-time-fold it prevents).
- `apps/chat/src/config/env.ts:70` — module-load `envSchema.parse(process.env)`; gate helpers `isSeekerChatEnabled` (`:108`) and `isSeekerEmailAllowed` (`:119`) read the module-level `env` constant.
- `apps/chat/src/lib/seeker-gate.ts` — `resolveSeekerGate`, the per-request gate the `force-dynamic` page re-runs.
- `apps/chat/package.json` scripts — `dev` (`next dev -p 3200`), `build` (`next build`), `start` (`next start -p 3200`).
- `apps/chat/CLAUDE.md` — "Server-side conversation history (feat-241)" and the KTD10 persisted-vs-never-persisted send semantics this matrix verifies.

Related learnings:

- `docs/solutions/developer-experience/chat-mastra-gated-stack-local-smoke-recipes.md` — the server-side sibling of this trap: mastra's `memory` backend is process-lifetime, so a _backend_ restart wipes seeded verification data. Same prevention theme ("plan verification around what a restart destroys"), different layer — that doc's remedy is "don't restart the process"; this doc's is "use a runtime where the restart can't reach the page."
- `docs/solutions/best-practices/synthetic-sse-fetch-patch-browser-verification.md` — prior "a reload wipes in-page verification setup" precedent (a `window.fetch` monkeypatch dies on any hard navigation); there the reload is voluntary, here it is forced by the dev runtime.
- `docs/solutions/best-practices/nextjs-server-action-error-redaction-prod-20260430.md` — prior art for the general principle that `next dev` is not a faithful stand-in for `next build` + `next start` (prod-only error redaction there; dev-only forced reload here).
- `docs/solutions/runtime-errors/nextjs-force-dynamic-runtime-env-flag-static-optimization-20260626.md` — the adjacent kill-switch trap on the _build_ side: a runtime env read silently baked into a statically-optimized route; its `force-dynamic` fix is one of the two facts that make the one-build-many-configs pattern above safe.
- `docs/solutions/best-practices/nextjs-cross-suspense-action-queue-with-url-params-20260421.md` — the **inverted** rule, kept distinct to avoid conflation: there, prod behavior hides a real bug that only `next dev` (Strict Mode) surfaces; here, dev-runtime behavior invalidates a check that only prod mode can host. Both are instances of "dev and prod runtimes differ — pick the one that exercises what you're actually testing."
- `docs/solutions/logic-errors/react-strictmode-remount-safety-hook-lifetime-refs.md` — feat-281's companion client-state-discipline learning (dev-StrictMode remount safety), same feature arc.
