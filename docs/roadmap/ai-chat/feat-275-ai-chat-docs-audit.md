---
id: "feat-275"
title: "Docs audit: chat + mastra Seeker CLAUDE.md drift sweep"
owner: "jian wei"
priority: "P2"
status: "complete"
start_date: "2026-07-21"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "ai-pipeline"
---

## Resolution

**Shipped:** 2026-07-21 via [PR #1638](https://github.com/JesusFilm/forge/pull/1638) (`docs(ai-chat): fix chat + mastra CLAUDE.md drift found by docs audit (feat-275)`).

**What landed.** A report-only claim audit of `apps/chat/CLAUDE.md` (whole
file) and `apps/mastra/CLAUDE.md` (Seeker/ai-chat scope) against code at
`34452229`: 101 checkable claims inventoried — 87 confirmed, 8 drifted, 0
wrong, and no cross-file contradictions on any shared contract. The 8 drift
fixes landed here. The two P1s were stale pre-feat-233 security posture: the
"unauthenticated open proxy / NOT a gate" risk paragraph (the per-user gate
now denies before any upstream call) and the "client-only, resets on refresh
(no DB/users yet)" sidebar claim (true only for anonymous/gate-denied users
since feat-241). The P2/P3s: the `min(seekerTimeoutMs, 10s)` read-budget
formula corrected to the real [9 s, 10 s] clamp (in both docs AND the one
stale `history-proxy.ts` header comment, so doc and code teach the same
formula), "per-agent in-memory Memory" → the shared ai-chat lane Memory,
"Studio-only" → internal-only (Studio + the bearer-gated `/forge-seeker`
dogfood surface), "inbound auth + rate caps remain" → the rate/concurrency
cap alone remains, the allowlist provenance (feat-233/feat-239), and the
incomplete `@vitest-environment node` test list (now a two-class rule with
the authoritative grep). Findings were independently re-verified by a second
agent session (all 8 upheld) before anything was applied.

**Residual risk / follow-ups.** Deliberately deferred code+test changes, not
made in this docs pass: `apps/mastra/src/mastra/budgets.test.ts:89-95` (its
comment still teaches the stale min() formula and its pin `historyRead <
10_000` is looser than the 9 s-floor invariant — tighten to `< 9_000` when
touched) and `apps/mastra/src/mastra/agents/seeker-agent.ts:191/:211` (the
"Studio-only / exercised only in Mastra Studio" description + SAFETY
instruction strings — the latter is part of the live prompt and pinned
verbatim by `seeker-agent.test.ts`, so it needs its own reviewed change).

## Problem

`apps/chat/CLAUDE.md` and `apps/mastra/CLAUDE.md`'s Seeker section were grown
feature-by-feature across the ai-chat lane (feat-198 → feat-270) and had
never been swept as a whole against the code. Layered "restated under
feat-NNN" amendments left passages asserting a pre-feat-233 world — most
seriously that `/api/seeker` is an unauthenticated open proxy whose junk
traffic writes durable rows — actively contradicting both the code and other
paragraphs in the same file. Agents reading the docs would build correct code
but misjudge the threat model.

## Entry Points — Read These First

1. `apps/chat/CLAUDE.md` — the audited file (whole).
2. `apps/mastra/CLAUDE.md` — "## Seeker agent" + every seeker/ai-chat mention
   (env table rows, the lane-exception bullet near the top).
3. `apps/chat/src/app/api/seeker/route.ts` — the "ACCESS POSTURE (feat-233)"
   header comment is the canonical current framing the P1 fix mirrors.
4. `apps/chat/src/app/api/history/history-proxy.ts` — `composeHistoryTimeoutMs`
   and the [9 s, 10 s] clamp constants.

## Grep These

- `grep -niE 'seeker|ai-chat|ai_chat|forge-seeker|history' apps/mastra/CLAUDE.md`
  — the mastra-side audit scope.
- `grep -rn "min(seekerTimeoutMs" apps/` — stale-formula sweep (only the
  deferred `budgets.test.ts` comment should remain).
- `grep -rln "vitest-environment node" apps/chat/src` — the authoritative
  node-directive list the fixed doc passage cites.

## What To Build

Done — see Resolution. Method, for reuse: claim inventory (101 numbered
checkable claims) → per-claim verification against source with file:line
evidence → cross-file consistency pass over the shared contracts → structure/
agent-usability pass → independent second-session verification of every
finding → apply.

## Constraints

- Ground truth is CODE; roadmap tickets and plans are intent context only —
  a doc claim verified only against another doc stays unverified.
- Report-only until findings are independently verified; docs-only apply pass
  (the single `history-proxy.ts` header-comment edit was the one explicitly
  approved code change).

## Verification

- `grep -rn "min(seekerTimeoutMs" apps/chat apps/mastra` → only
  `budgets.test.ts:91` (the deferred follow-up) remains.
- `grep -n "unauthenticated" apps/chat/CLAUDE.md` → no hits in the access-
  posture bullet.
- `pnpm --filter @forge/chat test` and `pnpm --filter @forge/mastra test`
  unaffected (docs + comment-only change).
