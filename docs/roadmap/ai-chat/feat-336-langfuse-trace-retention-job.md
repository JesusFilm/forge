---
id: "feat-336"
title: "Langfuse trace retention job (flat 25-day sweep)"
owner: "jian wei"
priority: "P2"
status: "complete"
start_date: "2026-08-10"
duration: 2
depends_on:
  - "feat-321"
blocks:
  - "feat-339"
tags:
  - "ai-pipeline"
  - "infrastructure"
---

## Resolution

**Shipped:** 2026-08-11 via [PR #1904](https://github.com/JesusFilm/forge/pull/1904) (`feat(mastra): langfuse trace retention sweep + flat 25-day retention (ai-chat feat-336)`).

**What landed.** Retention is now a flat 25 days across BOTH stores
(`AI_CHAT_RETENTION_DAYS`, one constant): the ai-chat Postgres purge was
flattened from the 30/180 split — the first production deploy therefore
runs a ONE-TIME purge of signed-in threads older than 25 days in its boot
drain (owner-accepted; be aware of this when timing that deploy) — and the
new Langfuse sweep (`apps/mastra/src/mastra/langfuse-trace-retention.ts`)
deletes seeker traces older than the window from the `forge-mastra`
project on a fixed 08:00 UTC wall-clock timer: boot only ARMS (runs/day =
1 by construction, guarded by a last-fired-day latch and a
boot-arms-never-sweeps test pin), so `MAX_DELETE_REQUESTS_PER_RUN = 40`
honestly equals the full 40/day allocation of the org's 50/day Hobby
delete quota, preserving ≥10/day feat-337 erasure headroom. The interim
in-memory verify-by-requery mechanism was deliberately REMOVED (inert at
the repo's ~10 deploys/day; failed deletions self-heal by re-listing;
the `oldest_age_days` / `retention_wall_risk` outcome metric is the
runtime verification). Capacity: 40 req/day × 50 ids = 2,000 traces/day —
sustained inflow beyond that is the Langfuse tier-upgrade signal, not an
engineering target.

**Compound docs.**
`docs/solutions/architecture-patterns/diy-retention-sweep-three-controls-visibility-walled-store.md`,
`docs/solutions/best-practices/per-run-caps-vs-per-day-quota-claims-restart-refreshed-jobs.md`,
and the amendment to
`docs/solutions/conventions/single-service-http-client-result-union-convention.md`.

**Residual risk / follow-ups.** Accepted scheduling residuals (LOW,
review-investigated): a genuine outage straddling 08:00 UTC skips that day
(deploys do NOT — Railway's healthcheck-gated promotion converts a
straddling deploy into a brief overlap); a deploy-overlap double-fire
costs ~2 requests at steady state and threatens quota only against a
≥2,000-trace backlog. Deferred mitigation: an atomic per-UTC-day
spend-claim ledger in Postgres (single conditional claim-BEFORE-spend
statement — a read-then-write counter reintroduces the race), build
triggers: audience widening, replicas > 1, or an observed sweep/erasure
quota collision; feat-337 should design any erasure-side spend recording
as its first consumer. Detection posture, stated honestly: the 28-day wall
warn detects sustained deletion failure ~3 days after traces overstay the
window, leaving a 2-day reaction margin — a margin of operator attention
(log lines, unalerted), conditioned on a run happening with an untruncated
listing (`list_truncated` warn = the prefix-only cue), and over this
visibility-walled store the warn is a self-silencing PULSE (rows past the
30-day wall leave the listing; absence of the warn is never recovery
evidence). ENABLEMENT CHECKLIST before/at first deploy: (1) alert on
ABSENCE of the daily `sweep_scheduled`/`sweep_complete` pair, not only on
warn presence; (2) exactly ONE Mastra deployment may hold the Langfuse
credential trio — a second environment is a second 40/day spender; (3) the
28-day warn threshold is coupled to the 25-day window — a future window
bump to 26–27d silently collapses the reaction margin (do NOT tighten the
threshold either; a single failed run false-positives at ~27). Operational
notes: first fire waits up to 24h after the feature's deploy; a failed
08:00 run retries at the next day's fire; each opt-in smoke run spends 1
of the day's 50 delete requests; the `Number.isNaN(cutoffMs)` cutoff guard
suggested independently by both security passes WAS taken (owner decision,
2026-08-11) — the listing refuses an unparseable cutoff before any request,
so the client-side mass-delete re-check is total even for direct callers.
feat-337 pointers: the ≥10/day erasure headroom is an arithmetic
convention, not enforced preemption; the visibility wall bounds erasure
COMPLETENESS (past-wall records are un-erasable on this tier — the
erasure runbook must carry the temporary tier-upgrade escape hatch with
lead time inside the statutory deadline).

**Unblocked.** feat-339 (seeker public-release readiness register) — its
retention gate is satisfied by this ticket.

## Problem

feat-321 exports raw seeker conversations (special-category personal data) to
the `forge-mastra` Langfuse project, and nothing ever deletes them:
configurable retention is a paid Langfuse feature (Pro, $199/mo) the owner
declined (2026-08-05), and WITHOUT a retention policy Langfuse deletes
nothing — ever (verified against the vendor's data-retention docs
2026-08-09). While `LANGFUSE_TRACING_ENABLED=true`, raw conversations
accumulate indefinitely. This job is the self-built daily sweep that
enforces retention.

**Policy (owner decision, 2026-08-10 — supersedes the 30/180-day split this
ticket previously mirrored):** retention is a FLAT **25 days for every
resource** — anonymous AND `user:*` — in BOTH stores. The ai-chat Postgres
purge (feat-208) is flattened to the same 25 days IN THIS TICKET (a small
constant change, folded in so the policy lands atomically; see What To Build
part A). Owner-accepted consequence: the first deploy's boot drain purges all
existing signed-in threads older than 25 days in one pass.

**Why 25 days (tier reality — RESOLVED, do not re-derive):** the org is on
the Langfuse **Hobby tier** (confirmed by owner, 2026-08-10). Hobby's 30-day
data-access window hides anything older from BOTH the UI and the API — the
data still exists (retention-off means nothing is auto-deleted), it just
becomes invisible and therefore un-listable, so a sweep can only delete what
is younger than 30 days. 25 keeps every target inside the visibility window
with a 5-day sweep-outage margin. Escape hatch if traces ever age past 30d
unswept: a temporary Core upgrade ($29/mo) restores 90-day access to drain,
then downgrade.

**Deadline:** the oldest traces in the project (2026-07-29 feat-321
verification smoke) turn 25 days old on **2026-08-23** and cross the 30-day
visibility wall around **2026-08-28**. Deployed-and-running by Aug 23 keeps
the full margin; each day past Aug 28 traps roughly a day of traces behind
the wall (recoverable only via the escape hatch).

Published Hobby limits (verified against vendor docs 2026-08-09; recheck at
build):

- **Trace deletion: 50 requests/day per organization** (the limit is on
  REQUESTS; each batch request carries multiple ids), with a vendor advisory
  of ≤30–50 trace ids per request (larger batches have real-world 502/504
  reports). Practical ceiling ≈ 2,500 traces/day — far above dogfood inflow.
- Listing via the successor endpoint (see What To Build): the general API
  bucket, 30 req/min.
- Rate-limit response shape: HTTP 429 + `Retry-After`.

**Semantics (accepted 2026-08-09):** Postgres purges on ROLLING last-activity
(`updatedAt`); Langfuse deletes on FIXED per-trace event time. Same 25-day
number, stricter effect in Langfuse: an active thread keeps its Postgres row
while its early turns' traces are deleted. Accepted because traces are
operator-facing observability, never user-facing history, and the divergence
errs privacy-safe. Do NOT build rolling/session-scoped semantics here:
Langfuse has NO session-delete API (the sessions resource exposes only
get/list, both legacy) — "delete the session" decomposes into exactly this
per-trace sweep.

Scope note (canonical: `apps/mastra/CLAUDE.md` § "Langfuse-only export"):
Langfuse is the ONLY store this job governs beyond the Postgres constant
change above. The feat-321 Langfuse-only decision (2026-08-05) means enabled
deployments write no raw trace copy to the local DuckDB volume — no local
sweep.

## Entry Points — Read These First

0. `apps/mastra/CLAUDE.md` → "Langfuse prompt management" → **Tracing /
   Langfuse-only export** — the canonical statement of what feat-321 exports,
   where, and the "never a DuckDB sweep / never a bare
   `MastraStorageExporter`" boundaries.
1. `apps/mastra/src/mastra/ai-chat-retention.ts` — BOTH halves of this ticket
   touch it: (a) the constants to flatten (`AI_CHAT_ANON_RETENTION_DAYS` 30 /
   `AI_CHAT_USER_RETENTION_DAYS` 180 → one flat 25), and (b) the pattern the
   Langfuse module mirrors for bounded sweeps, count-only logging, and the
   production-only CALL-SITE gate in `src/mastra/index.ts` — but since
   2026-08-11 deliberately NOT for scheduling: the Postgres purge keeps its
   boot drain + setInterval; the Langfuse sweep uses the fixed-time schedule
   in What To Build B.0.
2. `apps/mastra/src/services/langfuse-prompt-client.ts` (client posture) +
   `apps/mastra/src/config/env.ts` (`getLangfuseConfig()`) — the house
   Langfuse HTTP posture (Basic auth from the key pair, host allowlist, byte
   caps, no-throw unions). The sweep's list/delete calls reuse
   `getLangfuseConfig()` and follow the same conventions.
3. `apps/mastra/src/mastra/langfuse-tracing.ts` — how traces get their
   `userId` (the memory resource) and `sessionId` (threadId). Context only:
   with a flat window the sweep no longer discriminates on the resource
   prefix.
4. `apps/chat/src/components/chat/empty-state.tsx` (~lines 33–41) — the
   user-facing storage disclosure ("anonymous conversations are kept for 30
   days") + its tracking comment; becomes the flat-policy copy
   ("conversations are kept for 25 days", no anonymous qualifier), plus the
   test that pins it.
5. `apps/chat/src/auth/anon-id.ts` — the rolling anon-continuity cookie's
   30-day Max-Age is documented as "aligned with the anonymous retention
   window"; re-align to 25 days in the same change.

## Grep These

- `startAiChatRetentionPurge` — boot wiring precedent in `src/mastra/index.ts`
- `AI_CHAT_ANON_RETENTION_DAYS|AI_CHAT_USER_RETENTION_DAYS` — every reference
  to the constants being flattened (verify the full set before collapsing)
- `kept for 30 days` / `30d anon` / `30/180` / `180-day` / `180 day` — the
  copy + forward-looking-prose sweep targets (chat UI + tracked markdown)
- `LANGFUSE_SEEKER_TRACING_MARKER` — the tracing module this governs

## What To Build

**A. Flatten the retention policy to 25 days (Postgres + chat).**

1. In `ai-chat-retention.ts`: replace the 30/180 pair with ONE exported
   constant (`AI_CHAT_RETENTION_DAYS = 25`) — the Langfuse module imports the
   same constant (one policy, one source). Simplify `retentionWindowMsFor`
   (the prefix branch is dead under a flat policy) and the early-stop
   "shortest window" logic accordingly; keep the tests anti-vacuous — all
   three resource shapes (`user:*`, `anon:*`, `seeker-dogfood`) stay pinned
   to the same 25-day window so a reintroduced split fails loudly.
2. Chat disclosure copy in `empty-state.tsx`: states 25 days with no
   anonymous qualifier; update the tracking comment + the pinning test.
3. Anon cookie Max-Age in `anon-id.ts` (and its prose): 30 → 25 days, keeping
   the "aligned with the retention window" claim true.
4. Docs prose sweep (classify BY CONTENT — forward-looking instructions
   update; historical records stay verbatim, at most gaining a dated
   supersession note): `apps/mastra/CLAUDE.md` (retention bullet, seeker
   sections, the Langfuse-only-export paragraph's "30/180 days"),
   `apps/chat/CLAUDE.md` ("30d anon / 180d signed-in"),
   `docs/roadmap/ai-chat/feat-339-*.md` (two forward-looking 30/180
   references). Classify strictly BY CONTENT, never by document type (the
   root prose-sweep law): the feat-208 plan and completed tickets'
   Resolutions are usually historical (leave verbatim), but a
   forward-looking instruction inside one gets an additive dated
   supersession note (e.g. feat-321) — never a rewrite.

**B. `langfuse-trace-retention` module + a production-only FIXED-TIME daily
schedule (decided 2026-08-11; supersedes the boot-sweep + setInterval shape
this section previously prescribed).**

0. **Scheduling:** boot only ARMS a wall-clock timer — compute the delay to
   the next **08:00 UTC**, fire once, re-arm for the following day (a
   setTimeout chain, never setInterval; keep the unref posture). **No sweep
   runs at process start.** Emit
   `[langfuse-retention] event=sweep_scheduled next_fire=<iso>` at boot AND
   on every re-arm — the armed-but-never-fired state must be diagnosable
   from logs. Why: restarts re-aim at the same wall-clock target instead of
   minting fresh budget, so runs/day = 1 by construction; 08:00 UTC is the
   measured deploy trough (0 of 200 sampled merges), and Railway's
   healthcheck-gated promotion (`railway.toml` `healthcheckPath`) makes a
   deploy near the firing moment an overlap, never downtime. The accepted
   residual risks (rare skipped day, rare double-fire — both LOW) and the
   deferred Postgres spend-claim ledger go in the Resolution at ship time.

1. **List:** `GET /api/public/v2/observations` with
   `toStartTime = now − 25d`, `fields=core` (NEVER the `io` group — raw
   conversation text must not enter the Mastra heap; apply the house byte
   cap), cursor pagination, then dedupe rows to unique `traceId`s. This is
   the successor endpoint (resolved 2026-08-09 via the vendor's
   deprecated-API migration guide): do NOT use the deprecated
   `GET /api/public/traces` (deprecated classification, tightest rate
   bucket). No `userId` filtering — the window is flat.
2. **Delete:** `DELETE /api/public/traces` body `{ traceIds }`, ≤50 ids per
   request, per-run request budget ≤40 — the FULL 40/day retention
   allocation of the org's 50/day quota, honest because runs/day = 1 by
   construction under the fixed-time schedule (decided 2026-08-11; this
   supersedes the ≤10 divided cap of 2026-08-10, whose premise — ~4 boot
   sweeps/day each minting fresh budget — was removed along with the boot
   sweep). ≥10/day stays reserved as feat-337 erasure headroom (a pending
   erasure always wins over the sweep). Steady state at dogfood volume is
   ~1 request/day; sustained capacity is 40 × 50 = 2,000 traces/day. If
   audience widening, replicas > 1, or an observed sweep/erasure quota
   collision ever demands a hard guarantee, the deferred per-UTC-day
   spend-claim ledger in Postgres (claimed BEFORE requests fire, one
   conditional statement) is the honest control — do not rebuild divided
   caps.
3. **Deletion verification (decided 2026-08-11 — verify-by-requery DELETED,
   not merely documented as inert):** the module keeps NO
   pending-verification state — no in-memory set, no replace-vs-union
   carry-forward, no `delete_not_converging` line. Failed deletions
   self-heal structurally (an undeleted trace re-lists next run and is
   re-deleted); COMPLETION is verified by the outcome metric — every run
   reports `oldest_age_days` and warns `retention_wall_risk` at 28 days,
   detecting silently-failing deletion ~3 days after traces overstay the
   window and leaving a deliberate 2-DAY reaction window before the 30-day
   visibility wall (state this in the Resolution) — plus the opt-in smoke's
   API-level requery leg (backdated sentinel → delete → re-query absent),
   which is the only direct evidence deletions complete. Do NOT move the
   warn threshold to 27: a single failed/429 run on a healthy day reaches
   ~27 and would false-positive. **HTTP 429 + `Retry-After` stays a
   first-class outcome** with its own enum reason — never a swallowed
   error; the backlog carries to the next day's run (a failed 08:00 run
   retries in 24h). If a same-day convergence signal is ever wanted, it is
   DURABLE pending state riding the deferred ledger — never in-memory
   state, which is inert whenever deploys outpace the daily fire.
4. **Gating:** run when the Langfuse credential trio is configured —
   deliberately NOT gated on `LANGFUSE_TRACING_ENABLED` (the flag stops NEW
   exports; already-exported traces still need retention — the
   kill-switch-completeness-follows-data-lifetime law). Absent credentials →
   no-op with one quiet line. `.optional()` posture throughout; never
   required at boot.
5. **Logging:** enum/count-only plain-string
   `[langfuse-retention] event=sweep_complete listed=<n> deleted=<n> ...` —
   never trace content, user ids, or exception text. A sweep that cannot
   list or delete logs loudly EVERY run — silent under-deletion is the known
   DIY-retention failure mode this posture exists to catch.

Review-ratified additions (ce-code-review, 2026-08-11 — in scope): (a) a
last-fired-UTC-day latch in the re-arm — setTimeout waits on the MONOTONIC
clock while the re-arm reads the WALL clock, so a backward NTP step during
the ~24h wait could otherwise aim the re-arm at the SAME UTC day and double
that day's spend; the latch closes the one reviewer-found hole in the
runs/day = 1 premise; (b) a loud
`event=list_truncated oldest_age_basis=listed_prefix_only` warn — the
listing endpoint exposes no ordering, so a truncated listing makes
`oldest_age_days` a prefix-only statistic that must never read as
fully-measured; (c) `delete_requests` counts ATTEMPTS, incremented before
each call — a failed/429 request still spends org quota, so log-based
spend reconstruction stays honest.

Verify exact endpoint/filter shapes against the live API before building
(`npx langfuse-cli api observations --help` and
`npx langfuse-cli api traces --help` — resources are PLURAL; the singular
form silently falls through to generic help) — the API is the authority over
this ticket's parameter names.

## Constraints

- Single-instance assumption (same as ai-chat retention) — Mastra runs one
  replica; add a leader guard before scaling out.
- Never require new env vars at boot; uses the existing full-access key
  pair — no new credentials.
- Never the deprecated `GET /api/public/traces`; never rolling/session-based
  deletion semantics.
- Do NOT build a DuckDB sweep — Langfuse-only export makes it unnecessary
  (see Problem).
- One policy, one source: the Langfuse sweep imports the flattened constant
  from `ai-chat-retention.ts` — no mirrored literal.
- The shipping tail (ticket status flip, `## Resolution`, lane README row)
  is deliberately out of implementation scope — it lands with the eventual
  PR.

## Verification

- Unit: flat window math (all three resource shapes → 25d, anti-vacuous),
  sweep bounds + request budget + erasure headroom, no-config no-op,
  loud-failure + 429 branches — plus the scheduling pins (each
  anti-vacuous): boot ARMS but never sweeps (zero fetches at process
  start), fires at the next 08:00 UTC boundary and re-arms for the next day
  (fake timers over the injectable clock), the arithmetic pin names the
  runs/day = 1 premise (cap ≤ 40 — replacing, not deleting, the old
  cap×4 ≤ 40 pin), and the `sweep_scheduled` arming line asserted at boot
  AND on re-arm.
- Chat: disclosure copy + cookie Max-Age tests updated; a static string
  change needs no page-load-perf evidence (no rendering/hydration path
  changes) — state that in the report rather than silently skipping.
- Opt-in real-credential smoke (mirror `LANGFUSE_PROMPT_SMOKE_TEST`'s
  `describe.skipIf` pattern) covering LIST+DELETE+requery on a backdated
  sentinel — Langfuse ingestion accepts a client-supplied `timestamp` on
  `TraceBody`, so the window filter is smokeable directly. Written but left
  unrun without credentials.
- `pnpm --filter @forge/mastra test` and `pnpm --filter @forge/chat test`
  green; typecheck + lint both.
