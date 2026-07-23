---
id: "feat-282"
title: "Shared Mastra upstream transport for the chat proxies (narrowed)"
owner: "jian wei"
priority: "P2"
status: "complete"
start_date: "2026-07-21"
duration: 5
depends_on: []
blocks:
  - "feat-294"
tags:
  - "web"
---

## Resolution

**Shipped:** 2026-07-21 via [PR #1661](https://github.com/JesusFilm/forge/pull/1661)
(`feat(chat): extract shared Mastra upstream SSRF primitives (feat-282 PR 1)`)
and 2026-07-22 via [PR #1690](https://github.com/JesusFilm/forge/pull/1690)
(`feat(chat): narrowed shared Mastra transport for the chat proxies (feat-282 PR 2)`).

**What landed (PR 1).** `hostAllowed` + the loopback/railway helpers + the duplicated
`MAX_CONVERSATION_ID_CHARS` moved into the new server-only
`apps/chat/src/lib/server/mastra-upstream.ts`; both proxies import it and the
seeker route no longer exports SSRF primitives. The railway.internal
label-boundary matrix became direct unit coverage beside the module (22
tests), and each proxy suite carries a prod-transport
(`http://*.railway.internal`) allow-path wiring case — a Tier-2 review
addition closing a green-while-red gap the bare move would have opened.
Ruling 4a's `signIn` slot landed with a slot-identity test. One addition
beyond the ticket's letter: `import "server-only"` on the new module (five
review lenses converged on the unguarded `lib/server/` boundary; PR 2 adds
bearer-adjacent helpers there). Wire behavior identical; 510 tests /
typecheck / lint green.

**What landed (PR 2).** The narrowed shared transport in
`apps/chat/src/lib/server/mastra-upstream.ts`: `postMastraUpstream` (the one
POST fetch shape, with an origin pin throwing before the bearer attaches when
an absolute/scheme-relative path would escape the validated base — a
review-driven addition caught by the cross-model adversarial pass),
`composeUpstreamAbortSignal` (single-source identity preserved, so history's
bare-budget case keeps today's exact object), `classifyUpstreamFailure`
(`timeout | cancelled | network`; seeker's budget → caller-abort → error-name
precedence made canonical per Correction 3), and `readJsonCapped` +
`undefinedOnAbort` moved shared with direct unit coverage. The keep-list
stayed per-proxy: deny ladders, budgets and byte-cap sizes, response channels
and wire mappings over the discriminant, anon-cookie minting, the feat-236
gate short-circuit. The one declared hardening delta: the seeker 503
error-body read adopted `readJsonCapped` (64 KiB; over-cap/parse-fail/abort
all fold to the existing `config_missing`). One seeker test was semantically
rewritten (the mocked-`json()` abort-race test became vacuous under
`readJsonCapped`; it now drives a stalled real stream to the same wire frame).
571 tests / typecheck / lint green; browser-verified against live local
Mastra AND the Mastra-absent KTD8 states.

**Compound docs.** Two worked-instance rows + the refactor-relocates-risk rule
in `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`;
relocation scope note in
`docs/solutions/workflow-issues/mechanism-retirement-docs-prose-sweep.md`;
`docs/solutions/best-practices/guard-then-use-extraction-act-half-pins-invariant-20260722.md`
(the generalized origin-pin lesson, PR 2); PR-1 and PR-2 relocation notes in
`docs/solutions/architecture-patterns/browser-sse-proxy-to-bearer-gated-internal-sse-20260626.md`.

**Residual risk / follow-ups.** `feat-294` (branded `ValidatedBaseUrl` input —
the base-SSRF guard stays comment-coupled to the shared helper by design;
deferred by ruling agreement). A lint-level check for the 3-line
inline-comment cap was suggested by review and not pursued. The per-caller
rate cap on `/api/seeker` remains the standing open prerequisite before the
audience widens (unchanged here).

**Unblocked.** `feat-294`.

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
