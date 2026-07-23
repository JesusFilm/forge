# Chat App Architecture Review — Adjudicated Rulings Handoff

Date: 2026-07-21. Evidence verified at `54d4d9ba` (post-#1638 — the feat-275
docs audit is the only `apps/chat` change since the review evidence was
gathered; it shifted `history-proxy.ts` line numbers by one).

This is the durable record of an `/improve-codebase-architecture` review of
`apps/chat` (two parallel Explore sweeps: client modules, server modules) that
was then taken through a **three-session review chain**: an independent audit
of the review against the code, an adjudication that re-verified every
load-bearing claim from both sides and ruled per candidate, and an author
re-verification that confirmed every ruling and correction in code. The HTML
report and its diagram companion were session-local scratch artifacts (the
gitignored `reports/` folder) and are not available to future sessions —
**everything load-bearing is here.**

> **Completion status (2026-07-22):** every ruling in this document has been
> implemented or closed. Ruling 2 + 4a landed via feat-282
> ([PR #1661](https://github.com/JesusFilm/forge/pull/1661) +
> [PR #1690](https://github.com/JesusFilm/forge/pull/1690)); Rulings 1 + 3 +
> 4b via feat-281 ([PR #1666](https://github.com/JesusFilm/forge/pull/1666) +
> [PR #1674](https://github.com/JesusFilm/forge/pull/1674)); Rulings 4c and 5
> were closed by rejection, no action. Follow-up hardening beyond the rulings'
> scope is tracked as `feat-294`. This document is now a historical record,
> not pending work.

## How to use this doc

- **These are rulings, not candidates.** Unlike the TV review handoff
  (`2026-07-12-tv-architecture-review-findings.md`, "candidates, not committed
  work"), everything below has already been audited, adjudicated, and
  re-verified. Implement as specified. Do not re-open the settled questions
  (the rejections in Rulings 4c and 5, the narrowing in Ruling 2, the gate
  staying per-proxy).
- **Do not run `ce-plan` first.** This deliberately deviates from root
  `CLAUDE.md → Before Starting Work`: that flow assumes a cold ticket. This
  doc plus the tickets (`feat-281`, `feat-282`) _are_ the plan, produced by a
  process more rigorous than a planning session. The tickets carry the
  ordered steps and verification commands.
- **Amendment protocol.** If investigation or code review forces a deviation
  from something this doc _specifies_, append a dated, PR-tagged amendment at
  the bottom of the affected ruling's section, **in the same PR as the
  deviation**:
  `> **Amendment (YYYY-MM-DD, PR #NNNN):** what changed · what forced it ·
what still holds.`
  Amend only when the doc says X and you did Y — details the doc is silent on
  belong in the PR description, not here. An amendment records a deviation in
  _how_, within the ruling's spirit. It must never silently overturn a ruling
  itself — see the next bullet.
- **Stop-and-report clause.** If you conclude a _ruling_ is wrong (e.g. "the
  session module shouldn't exist", "the transport narrowing is untenable",
  "the StrictMode re-arm discipline cannot be made to pass"), stop and report
  to the owner (jian wei) instead of improvising a new design mid-flight.
  Amend for _how_; stop for _whether_.
- **Prefer symbol names and grep patterns over line numbers.** Cites were
  exact at `54d4d9ba` and have already shifted once this week from a docs-only
  commit.
- **Vocabulary** (the review's terms, defined here because the source skill is
  not in this repo): a **module** is anything with an interface and an
  implementation; its **interface** is everything a caller must know (types,
  invariants, error modes — not just signatures); a module is **deep** when a
  small interface hides a lot of behavior and **shallow** when the interface
  is nearly as complex as the implementation; a **seam** is where an interface
  lives and behavior can be swapped; an **adapter** satisfies an interface at
  a seam; **leverage** is what callers gain from depth, **locality** is what
  maintainers gain (change and bugs concentrate in one place).

## Sequencing (the ruling — order matters, dates don't)

1. **feat-282 PR 1** — small unconditional PR: `hostAllowed` + helpers + the
   duplicated constant out of the seeker route file (SSRF test matrix moves
   with it), plus the SignInLink `signIn`-slot drive-by (Ruling 4a).
2. **feat-281** — the conversation session module arc (Rulings 1 + 3 + 4b), as
   two stacked PRs from one session. Whole-tree + StrictMode suites stay green
   as the acceptance gate.
3. **feat-282 PR 2** — the narrowed shared transport + shared `readJsonCapped`
   with the seeker-503 adoption declared as a hardening delta. Waits only on
   the feat-281 arc (review-load + both edit `apps/chat/CLAUDE.md`) — NOT on
   feat-209.
4. **feat-209** — re-sequenced, not a step of this work: its one ordering
   edge is AFTER feat-281 (`start_date` pushed, `depends_on` added); it lands
   later as a URL adapter over the session interface. It is **unordered
   relative to feat-282 PR 2** (zero file overlap — expected after it per the
   ticket dates, but nothing requires that).
5. **Rulings 4c and 5** — closed, no action, do not schedule.

Steps 1–3 execute sequentially (feat-281 and feat-282 PR 1 touch disjoint
code but both update `apps/chat/CLAUDE.md`; parallel execution buys a
guaranteed conflict for ~an hour saved). The only **hard** dependency in this
plan is feat-281 → feat-209.

## Corrections to the original review (verified in code — do not re-derive from stale claims)

1. `UseConversations` has **16** returned fields (8 data + 8 callbacks), not
   18 (`src/lib/use-conversations.ts`, the `UseConversations` type).
2. `src/auth/session-cookie.ts` has **14** value exports (5 cookie-name
   consts + 3 TTL consts + 6 functions), not 10.
3. The two proxies' transport classifiers **diverge deliberately**: seeker
   composes three abort sources (including the handler-owned `upstreamAbort`)
   vs history's two, and only seeker's catch has a
   `requestSignal?.aborted → "cancelled"` branch. A literal unification would
   change wire behavior — hence the Ruling 2 narrowing.
4. Git heat: only the trunk (#1276), feat-205, feat-241, and feat-270 ever
   touched `use-conversations.ts`. feat-267/268/269 landed in
   `components/chat/`. The ranking survives the correction — the load-bearing
   fact was always the test scaffold, not the commit count.
5. StrictMode direction: the whole-tree remount suites **stay** (they are the
   acceptance gate), and the new adapter needs its **own** StrictMode suite.
   The original "StrictMode surface shrinks" claim was backwards.

## Standing decisions — do not re-litigate

- The browser → chat proxy → Mastra SSE architecture (feat-205; settled).
- The three independent markdown containment guards (feat-268; settled).
- The open-proxy accepted-risk posture: inbound auth + rate cap are the
  recorded prerequisite before the audience widens — not a refactor to sneak
  in here.
- Anonymous ephemerality (feat-241): the anon continuity cookie never becomes
  a history-reading credential.
- R21 / R22 / KTD10 semantics are decided _behavior_. This work relocates
  where they live; it must not change what they do.
- The Seeker Dogfood Gate short-circuit stays **per-proxy**, never in shared
  transport: feat-236 deletes the gate step from both proxies at teardown
  (compile-forced via the `gate_denied` union member), and phase-scoped
  scaffolding must not move into permanent shared infrastructure.

---

## Ruling 1 — Conversation session module (IMPLEMENT — ticket `feat-281`, lands before feat-209)

**Files:** `src/lib/use-conversations.ts` (742 lines) ·
`src/components/shell/app-shell-test-harness.tsx` (304) ·
`src/components/shell/app-shell.test.tsx` (886) ·
`src/components/shell/app-shell.history.test.tsx` (645).

**Problem (verified).** One hook holds every conversation machine — 6
`useState` + 9 `useRef` (15 mutable cells), 3 effects (two with
`eslint-disable exhaustive-deps`), ~13 responsibilities: the 116-line 4-way
`send()` finalize, per-conversation abort slots (`controllersRef` +
`stoppedRef`), history hydration/paging, merge, replay single-flight, R22 send
blocking, KTD10 stamping at 4 scattered sites, title logic split over 2 sites,
`revertToClientOnly`, sidebar projection. Its own test file (221 lines) covers
only the 4 exported pure helpers (`mergeServerThreads`, `mergeReplayMessages`,
`orderConversations`, `listConversations`); every load-bearing behavior is
reachable only through the 304-line harness + 1,531 lines of whole-tree suites
with mocked fetch and fake timers.

**Design.** Extract a framework-agnostic session module owning the machines;
`useConversations` becomes a thin React adapter over it
(`useSyncExternalStore`). Indicative interface (exact shape is the
implementer's; deviations from what IS specified here get amendments):

```ts
type ConversationSession = {
  subscribe(listener: () => void): () => void
  getSnapshot(): ConversationSessionSnapshot // cached; new identity only on real change
  send(text: string): void
  stopReply(): void
  selectConversation(id: string): void
  newConversation(): void
  retryHistory(): void
  loadMoreHistory(): void
  retryReplay(): void
}
type ConversationSessionDeps = {
  streamReply: typeof streamReply // injected — tests hit the seam directly, no DOM
  fetchHistoryPage: typeof fetchHistoryPage
  fetchHistoryThread: typeof fetchHistoryThread
  seekerEnabled: boolean
}
```

**Adjudicated design requirements (each verified against the code):**

1. **`getSnapshot` must return a cached, identity-stable snapshot per
   version.** Today's hook return (end of `use-conversations.ts`) is a fresh
   object literal every render — fine for a hook, an infinite-loop bug for a
   raw `useSyncExternalStore` snapshot.
2. **The session instance must survive dev StrictMode's
   setup → cleanup → setup.** The current mount effect's cleanup mutates
   hook-lifetime refs (`mountedRef`, aborts + clears `controllersRef`, nulls
   `historyAbortRef`) and its setup restores them — the exact trigger of
   `docs/solutions/logic-errors/react-strictmode-remount-safety-hook-lifetime-refs.md`.
   If cleanup aborts session controllers, setup must re-arm the same
   instance. Construction must be side-effect-free (`useState` initializers
   double-invoke in dev); hydration stays effect-triggered.
3. **The whole-tree suites are the acceptance gate and none are deleted** —
   including the `Remount safety (dev StrictMode cycle)` describe in
   `app-shell.history.test.tsx`. The new adapter gets its **own**
   StrictMode-rendered suite; the session module gets a direct unit suite
   with injected deps. The harness shrinks for _new_ tests only.
4. **The interface serves anonymous/stub users too.** The hook runs regardless
   of gate outcome (hydration gates on `seekerEnabled`; sends don't). Don't
   accidentally shape the session seeker-only.
5. **KTD10 stamping concentrates in the session** (today: 4 sites — the
   `allowStubFallback` computation plus three `markServerPersisted` branches).
   Behavior identical; location single.
6. **`HistoryListUi` + the `listConversations` projection move out of the
   hook** into a sidebar-facing module (Ruling 4b rides this arc; the type is
   consumed by `sidebar.tsx` + `sidebar-conversation-list.tsx`).
7. **`apps/chat/CLAUDE.md` updates ride each PR that invalidates it** — PR 1
   already rewrites the Architecture / state-ownership story (the hook no
   longer owns the machines), PR 2 the seam/KTD10 story. feat-275 just
   audited that file — do not re-create the drift it cleaned.
8. **Two stacked PRs from one session:** PR 1 extracts the session module +
   adapter with zero behavior change; PR 2 folds in Ruling 3 + the projection
   move + the feat-236 prose update.

**Future consumers (context, not scope):** feat-209 (URL adapter over
`selectConversation`/`newConversation`/snapshot), feat-247 (delete/rename
actions land on this interface), feat-248 (anon→account migration).

**Grep anchors:** `UseConversations`, `controllersRef`, `stoppedRef`,
`markServerPersisted`, `allowStubFallback`, `revertToClientOnly`,
`HistoryListUi`, `listConversations`, `Remount safety`.

## Ruling 2 — Narrowed shared Mastra transport (IMPLEMENT — ticket `feat-282`, two PRs)

**Files:** `src/app/api/seeker/route.ts` (410 lines) ·
`src/app/api/history/history-proxy.ts` (~385) · their test files.

**Problem (verified).** The two proxies independently implement ~11 identical
transport concerns (4-field config shape, gate short-circuit, config-present
check, bearer construction, `AbortSignal.timeout` + `AbortSignal.any`
composition, POST/json/`redirect:"error"` fetch shape,
`new URL(path, baseUrl)`, slow-body-vs-abort race, enum-only plain-string
logging, a duplicated `MAX_CONVERSATION_ID_CHARS = 200`). The only shared code
is `hostAllowed` — defined and **exported from the seeker route file**, which
the history proxy imports (a route doubling as a library). But the
classifiers diverge deliberately (Correction 3), and the response channels
are different by design: seeker normalizes every failure to one terminal SSE
`error{reason}` frame; history returns typed HTTP statuses per KTD8.

**PR 1 — unconditional moves (lands first, before feat-281):**

- Move `hostAllowed` + `LOOPBACK_HOSTS` + `isRailwayInternalHost` + the
  duplicated `MAX_CONVERSATION_ID_CHARS` out of `seeker/route.ts` into a lib
  module (e.g. `src/app/api/mastra-upstream.ts` or `src/lib/server/`);
  both proxies import from it.
- **The SSRF label-boundary test matrix (the `railway.internal` cases in
  `route.test.ts`) moves WITH the function** as direct unit coverage at its
  new home — it must not survive only as transitive coverage of a re-export.
- Ruling 4a (the SignInLink `signIn` slot) rides this PR as a drive-by.

**PR 2 — the narrowed shared layer (after the feat-281 arc):**

- Share: the fetch shape (bearer + content-type + `redirect:"error"` +
  signal), signal composition, and an error-**discriminant** classifier
  (`timeout | cancelled | network`) that takes the signals as explicit inputs
  and **preserves seeker's check precedence** (budget-aborted →
  caller-aborted → error name). Each proxy keeps its own wire mapping over
  the discriminant.
- Share `readJsonCapped` + the abort-race helper (today history-local), and
  **the seeker 503 path adopts it**: its current raw `response.json()` is
  time-raced but not byte-capped — a byte-cap-law violation on an error-path
  read. Declare this adoption as a **deliberate hardening delta in the PR
  description** — it is the one intentional wire-behavior change in this
  entire body of work (over-cap 503 bodies map to the existing
  `config_missing` outcome, same as today's parse failure).
- Keep per-proxy: deny ladders, body-read strategies, budgets
  (`composeHistoryTimeoutMs` clamp vs the 95s send ceiling), response
  channels, anon-cookie minting (seeker-only), and the gate short-circuit
  (Standing decision — feat-236 teardown).
- `apps/chat/CLAUDE.md` proxy sections update in the same PR.

**Future consumer:** feat-247's expected "ownership-gated write route(s)
mirroring feat-241's read-path patterns" — a third proxy-shaped consumer.

**Grep anchors:** `hostAllowed`, `isRailwayInternalHost`,
`MAX_CONVERSATION_ID_CHARS`, `readJsonCapped`, `undefinedOnAbort`,
`AbortSignal.any`, `redirect: "error"`, `railway.internal`.

## Ruling 3 — Honest `gate_denied` at the reply seam (IMPLEMENT — only inside feat-281's arc)

**Problem (verified).** `streamReply` remaps a Seeker Dogfood Gate denial into
a fake success (engine flipped to `"stub"`) unless the caller passes
`allowStubFallback: false`; the KTD10 concept consequently spans four modules
(`use-conversations.ts`, `chat-stub.ts`, `conversations.ts`,
`message-list.tsx`).

**Design.** The seam always returns `{ ok: false, reason: "gate_denied" }`
truthfully; the session (which owns persisted-ness) decides stub-vs-failure;
`allowStubFallback` leaves the interface. Same user-visible behavior,
relocated decision.

**Conditions:**

1. **Implementation trap (verified):** today's fallback builds the successful
   stub terminal **immediately** — inline `buildStubReply`, no 800ms
   `STUB_REPLY_DELAY_MS`, no tokens, engine `"stub"`. The session must
   reconstruct that result directly; re-entering `streamStubReply` would
   introduce a delay and change observable behavior.
2. **feat-236's step-2 prose updates in the same PR.** Its greps are the
   covenant's source of truth, and its compile-forced lever — removing the
   `gate_denied` member from `REPLY_FAILURE_REASONS` in `conversations.ts` —
   follows the mapping wherever it lives. Repoint EVERY step-2 / Grep-These
   file reference the refactor relocates — not just the
   `chat-stub.ts (streamSeekerReply)` client-site mention but also the
   hydration-condition reference to `lib/use-conversations.ts` (hydration
   moves into the session module) and any other client-file pointer the
   move invalidates.

**Grep anchors:** `allowStubFallback`, `gate_denied`, `buildStubReply`,
`REPLY_FAILURE_REASONS`.

## Ruling 4 — Sidebar (SPLIT)

**(a) SignInLink drive-by — IMPLEMENT, rides feat-282 PR 1.** `SignInLink` in
`sidebar-account.tsx` hard-codes a near-twin of `collapsedStyles.newButton`,
keyed off `styles.account` truthiness. The copies differ by `md:mx-auto` +
`md:hover:border-transparent`, so the fix is a **new dedicated `signIn` slot**
in `sidebar-collapsed-styles.ts` (not `newButton` reuse — that would change
rendering), which also removes the truthiness coupling. Grep:
`md:border-transparent`, `collapsedStyles`.

**(b) `HistoryListUi` + projection move — IMPLEMENT, rides feat-281** (Ruling
1, requirement 6).

**(c) Prop-grouping — REJECTED.** 15 typed props with 4 consumed locally is
the settled feat-203 presentational shape; grouping is churn with no defect
behind it. Do not schedule.

## Ruling 5 — Cookie-primitives regroup (REJECTED)

`session-cookie.ts`'s 14 exports are cohesive per-kind constants/functions
consumed across the auth routes and node-env suites; the two-reader
divergence (`readRequestCookie` decodes — load-bearing for URL-valued cookies
like `return_to`; `getCookieValue` in `anon-id.ts` deliberately doesn't) is
documented in both modules. Auth is untouched since feat-240 and was
doc-audited the day of this review (feat-275, PR #1638). A regroup churns a
security-sensitive area and trips mandatory Tier-2 review for zero behavior
gain. Do not schedule; revisit only if the area is being changed for feature
reasons anyway.

## feat-209 ordering (ruled)

feat-209 does **not** ship first. Its Entry Points name exactly the surface
Ruling 1 relocates (`activeId` / `selectConversation` / `newConversation`
"become URL-driven"), its grep section expects `useRouter|usePathname` absent
today (verified absent), and its no-remount/no-dropped-streams requirement
would otherwise wire routing into the 742-line hook and be redone after the
refactor. Built after, it collapses to a thin URL adapter over the session.
The ticket's `start_date` is pushed and `depends_on: feat-281` added (this
lane computes nothing — `blocked` is manual here; the dependency is
documentation).

## Verification expectations (every PR in this body of work)

- `pnpm --filter @forge/chat test` / `typecheck` / `lint` — all green; no
  existing suite deleted or skipped.
- **Browser verification via the in-container headless Chromium** (the
  `chrome-devtools` MCP server configured in the repo's `.mcp.json`).
  Scope per ticket: feat-281 verifies the full conversation lifecycle
  (send/stream/stop on the zero-env stub path, new/select/switch mid-stream,
  sidebar states; plus the gate-granted Seeker path — history hydration,
  replay, R22 blocking). feat-282 verifies sends + history against local
  Mastra AND the KTD8 failure/retry states still render when Mastra is
  absent. The operator's handoff prompt supplies the local recipes for the
  gate-granted sign-in and the local Mastra setup (workspace-specific; not
  recorded here).
- **Tier-2 `/ce-code-review` after implementation, before push** — both
  tickets trip the mandatory triggers. Apply (don't defer) P2+ findings at
  confidence 75+.
- Amendments to this doc ride the same PR as the deviation (see protocol
  above).
- Tickets flip `in-progress` as the session's first act; `complete` +
  `## Resolution` + lane README row update land inside the arc's final PR
  (lane convention).
