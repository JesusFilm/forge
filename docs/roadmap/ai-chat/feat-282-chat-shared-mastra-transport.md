---
id: "feat-282"
title: "Shared Mastra upstream transport for the chat proxies (narrowed)"
owner: "jian wei"
priority: "P2"
status: "in-progress"
start_date: "2026-07-21"
duration: 5
depends_on: []
blocks: []
tags:
  - "web"
---

## Problem

`apps/chat`'s two Mastra proxies — `src/app/api/seeker/route.ts` (SSE send
path) and `src/app/api/history/history-proxy.ts` (Conversation History read
path) — independently implement ~11 identical transport concerns (config
shape, bearer, timeout composition, `redirect:"error"` fetch shape, abort
races, logging convention, a duplicated `MAX_CONVERSATION_ID_CHARS`). The only
shared code, `hostAllowed`, is exported from the seeker **route file**, which
the history proxy imports — a route doubling as a library. A fix to the
SSRF/timeout discipline must currently land twice and the twins can drift
silently. Separately, the seeker 503 error-body read is a raw
`response.json()` — time-raced but not byte-capped, violating the repo's
byte-cap law on an error-path read.

This ticket is **Ruling 2** (+ Ruling 4a as a PR-1 drive-by) of the
adjudicated architecture review. The authoritative spec is
`docs/handoffs/2026-07-21-chat-architecture-review-rulings.md` — read it first
in full; note what is deliberately NOT shared. Do NOT run `ce-plan`.

## Entry Points — Read These First

1. `docs/handoffs/2026-07-21-chat-architecture-review-rulings.md` — Ruling 2
   (the share-list vs keep-list), Correction 3 (why the classifiers can't
   unify literally), Ruling 4a (the SignInLink slot drive-by).
2. `apps/chat/src/app/api/seeker/route.ts` — `hostAllowed` +
   `LOOPBACK_HOSTS` + `isRailwayInternalHost` (moving out); the three-source
   signal composition and catch-classifier precedence (budget → caller-abort
   → error name); the 503 raw `response.json()` adopting `readJsonCapped`.
3. `apps/chat/src/app/api/history/history-proxy.ts` — the two-source
   composition, `readJsonCapped` + `undefinedOnAbort` (moving to the shared
   module), the import of `hostAllowed` from the sibling route.
4. `apps/chat/src/app/api/seeker/route.test.ts` — the `railway.internal`
   label-boundary SSRF matrix: it MOVES with `hostAllowed` as direct unit
   coverage at the new home.
5. `apps/chat/src/components/shell/sidebar-account.tsx` (`SignInLink`) +
   `sidebar-collapsed-styles.ts` — the Ruling 4a drive-by (new `signIn` slot;
   the hand-copied string differs from `newButton` by `md:mx-auto` +
   `md:hover:border-transparent`).
6. `apps/chat/CLAUDE.md` — proxy sections; update in the same PR(s).

## Grep These

- `hostAllowed` / `isRailwayInternalHost` / `LOOPBACK_HOSTS` — everything
  moving in PR 1
- `MAX_CONVERSATION_ID_CHARS` — the duplicated constant (two definitions →
  one)
- `readJsonCapped` / `undefinedOnAbort` — moving to shared in PR 2
- `railway.internal` — the test matrix that moves with the function
- `AbortSignal.any` / `redirect: "error"` — the fetch shape being shared
- `md:border-transparent` — the SignInLink hand-copied string (Ruling 4a)
- `resolveGate` — must stay per-proxy (feat-236 teardown; NOT shared)

## What To Build

**PR 1 — unconditional moves (lands first, before feat-281 starts):**

- New lib module (e.g. `apps/chat/src/lib/server/mastra-upstream.ts`) owning
  `hostAllowed`, `LOOPBACK_HOSTS`, `isRailwayInternalHost`,
  `MAX_CONVERSATION_ID_CHARS`. Both proxies import from it; the seeker route
  stops exporting SSRF primitives.
- The SSRF label-boundary matrix moves to a colocated test of the new module
  (not left as transitive coverage of a re-export).
- Drive-by (Ruling 4a): add a dedicated `signIn` slot to
  `collapsedStyles`, preserving SignInLink's EXACT current classes (do not
  reuse `newButton` — it differs), and key SignInLink's collapse off the new
  slot instead of `styles.account` truthiness.

**PR 2 — the narrowed shared layer (after the feat-281 arc merges):**

- Shared fetch-shape helper (bearer + content-type + `redirect:"error"` +
  signal), shared signal composition, and a shared error-DISCRIMINANT
  classifier (`timeout | cancelled | network`) taking the signals as explicit
  inputs and preserving seeker's check precedence; each proxy keeps its own
  wire mapping over the discriminant.
- `readJsonCapped` + `undefinedOnAbort` move to the shared module; the seeker
  503 path adopts `readJsonCapped` (over-cap → the existing `config_missing`
  outcome). **Declare this in the PR description as the one deliberate
  hardening delta** — everything else is wire-behavior-preserving.

## Constraints

- Wire behavior identical except the declared 503 byte-cap delta. The proxy
  test suites (1013 + 76 + 462 + 167 lines) are the contract — they pass
  unmodified except where imports/module paths move.
- Keep per-proxy (do NOT share): deny ladders, body-read strategies, budgets,
  response channels, anon-cookie minting, and the gate short-circuit
  (feat-236 deletes the gate step from both proxies; phase-scoped scaffolding
  must not enter permanent shared infrastructure).
- PR 2 waits for the feat-281 arc (sequencing ruling; avoids CLAUDE.md
  conflicts and review-load stacking).
- Flip this ticket `in-progress` (+ lane README row) at PR 1 start;
  `complete` + `## Resolution` + README row land in PR 2.

## Verification

- `pnpm --filter @forge/chat test` / `typecheck` / `lint` green on both PRs.
- Browser (headless Chromium, `chrome-devtools` MCP): sends + history work
  against local Mastra (if something already listens on its port it is the
  operator's instance — use it, never kill or restart it; the operator's
  handoff prompt supplies the local setup recipe), AND the KTD8 failure/retry
  states render when Mastra is absent (config gap = visible outage to a
  granted user, never silent).
- Tier-2 `/ce-code-review` after implementation, before each push (sensitive
  surface — mandatory); apply P2+ findings at confidence 75+.
- PRs assigned to `jianwei1`; squash-merge to `main`.
