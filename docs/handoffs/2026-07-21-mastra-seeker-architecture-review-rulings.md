# Mastra Seeker / ai-chat Lane Architecture Review — Adjudicated Rulings Handoff

Date: 2026-07-21. Evidence verified at `54d4d9ba`, re-checked after the
fast-forward to `f4920a3e` (`git diff 54d4d9ba..f4920a3e -- apps/mastra` is
empty — no audited file changed in between).

This is the durable record of an `/improve-codebase-architecture` review of
the **ai-chat lane's footprint inside `apps/mastra`** — the seeker agent +
`/forge-seeker` route, the `retrieveAnswer` tool + JesusFilm RAG client, the
history read surface, the thread-ownership gate, the retention purge, and the
ai-chat halves of `memory.ts` / `config/env.ts` / `mastra/index.ts` — that was
then taken through a **two-session review chain**: an independent session
verified every load-bearing claim against the source and the decision records
(nine findings: two overstatements, one factual error, two missed points,
three conditions, one sequencing endorsement), and the author re-verified each
finding in code before adopting it (all nine adopted; none failed
verification). The HTML report and its diagram companion were session-local
scratch artifacts and are not available to future sessions — **everything
load-bearing is here.**

## How to use this doc

- **These are rulings, not candidates.** Everything below has been audited,
  independently verified, and re-verified in code. Implement as specified. Do
  not re-open the settled questions (the Standing decisions below, Ruling 1's
  narrowed scope, Ruling 2's recall boundary, Ruling 3's ride-along trigger).
- **Do not run `ce-plan` first.** This deliberately deviates from root
  `CLAUDE.md → Before Starting Work`: that flow assumes a cold ticket. This
  doc plus the tickets (`feat-283`, `feat-284`, `feat-285`) _are_ the plan,
  produced by a process more rigorous than a planning session. The tickets
  carry the ordered steps and verification commands.
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
  admission module shouldn't exist", "the read resolver can't preserve the
  fail-closed contract", "the discriminating key-source test cannot be
  written"), stop and report to the owner (jian wei) instead of improvising a
  new design mid-flight. Amend for _how_; stop for _whether_.
- **Prefer symbol names and grep patterns over line numbers.** Cites were
  exact at `54d4d9ba`/`f4920a3e` and will shift.
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

1. **feat-283** — the lane admission module, now. **Gated inside the PR** on
   the discriminating key-source test (Ruling 1, requirement 1): deleting the
   two `seeker-route-isolation.test.ts` regex pins without that test is a net
   security downgrade, so pins and test swap in the same PR or the PR does
   not land.
2. **feat-284** — the thread-ownership read resolver, minimal and soon. It is
   justified by the existing replay handler alone; it does not wait for
   feat-247 and must not pre-design for it.
3. **feat-285** — the ai-chat memory extraction + keying policy, as a
   **ride-along with the next PR that materially touches `memory.ts`'s
   ai-chat half or adds a second agent-turn route** — not standalone work.

**HARD ordering edges: none.** No ruling depends on another for correctness;
feat-283's gate is a within-PR condition, not an edge between tickets.

**SOFT ordering edges (conflict avoidance only — execute sequentially, do not
encode as `depends_on`):**

- feat-283 → feat-284: both edit `ai-chat-history-route.ts` and
  `apps/mastra/CLAUDE.md`. Parallel execution buys a guaranteed conflict.
- feat-283 → feat-285 (if feat-285's trigger fires while feat-283 is in
  flight): both edit `agents/seeker-route.ts`.
- feat-247 (delete/rename, a brainstorm-first stub) should consume feat-283's
  admission module and feat-284's resolver rather than mirroring today's
  hand-rolled patterns — recorded as documentation `depends_on` on feat-247
  (this lane computes nothing; `blocked` is manual here).

feat-271 (RAG corpus cleanup) is unaffected — its seam
(`tools/retrieve-answer.ts`) is a Standing decision below.

## Corrections to the original review (verified in code — do not re-derive from stale claims)

1. `src/mastra/memory.ts` has **18** exports (8 ai-chat + 10
   experience-chat), or 13 excluding the five `__reset*ForTesting` hooks —
   not 12.
2. The admission preamble is **two implementations serving three routes** —
   the history list and replay handlers already share `refuseUnlessAdmitted`
   inside `ai-chat-history-route.ts`; only `seeker-route.ts` re-implements it
   — not "three hand-rolled ladders".
3. Replaying an owned thread runs `getThreadById` **twice** (once inside
   `authorizeAiChatThreadAccess`, once as the handler's explicit existence
   check); replaying a missing thread costs **three** store queries
   (`getThreadById` ×2 plus the gate's ceiling `listThreads`) where one
   answers everything.
4. The existing default-key-source test in `ai-chat-history-route.test.ts`
   ("fails closed when the lane CSV is unset") only proves
   fail-closed-when-unset — with both CSVs empty in the test env it cannot
   discriminate whether the default reads `AI_CHAT_SERVICE_API_KEYS` or
   `MASTRA_SERVICE_API_KEYS`. The history side carries that latent gap
   **today**: nothing but review guards a one-line edit of
   `readLaneServiceKeys` to the pool CSV.
5. "Wrong wiring becomes unrepresentable" is scoped: the refactor makes the
   **registration site** unable to express a pool-key revert; the revert
   surface moves into the module, where only Ruling 1's discriminating test
   detects it.

## Standing decisions — do not re-litigate

- **The `retrieveAnswer` ⇄ `jesusfilm-rag-client` split stays.** The client
  is a deep module (one function hiding the byte-cap / no-throw / redirect
  hardening) per the repo's single-service HTTP-client convention, and
  feat-271's cleanup pass is scoped to land at exactly this seam.
- **The narrow-type-per-consumer pattern stays** (`AiChatOwnershipMemory`,
  `AiChatRetentionMemory`, `AiChatHistoryMemory` — feat-241 KTD3): one narrow
  structural type per consumer module, all satisfied by the same real
  `Memory`.
- **The retention purge stays as-is** — probe, drain valve, recency
  re-check, and the kill-switch/persistence asymmetry are deep behind one
  `startAiChatRetentionPurge` interface.
- **The SSE stream plumbing in `seeker-route.ts` is not extracted.** Its only
  twin is `experience-chat-route.ts`, outside this lane's seams — one in-lane
  adapter is a hypothetical seam. Noted for a future cross-lane pass only.
- **Per-route in-handler bearer validation, never `/api/*` middleware**
  (feat-241 KTD2 — middleware breaks Studio). Ruling 1's module is a function
  handlers call; that stays in-handler.
- **The wire contracts to `apps/chat` are frozen**: the `/forge-seeker` SSE
  frame vocabulary (`token_delta` / `result` / `error` with fixed reasons)
  and the history wire projections (`{ id, title, updatedAt }` lists;
  `{ id, role, text, createdAt }` replay).
- **The per-branch fail-mode split is decided behavior** (feat-208 plan §C:
  ownership fails CLOSED via `getThreadById`'s store-error throw; the
  creation ceiling fails OPEN via `listThreads`' swallow). This work
  relocates where the facts are composed; it must not change what they do.
- **Budget→reason vocabularies stay per-route**: the send route maps budget
  expiry to in-stream `timeout` / `generation_failed` SSE error frames; the
  history routes to JSON `timeout` / `store_failed` with 504/500. They are
  different by design and are NOT part of Ruling 1's shared module.
- **`assertAiChatServiceKeysDisjoint` stays in `config/env.ts`** as the boot
  invariant; Ruling 1 does not move or weaken it.
- The open-proxy accepted-risk posture (feat-208 plan §F): inbound auth +
  rate caps are the recorded prerequisite before the audience widens — not a
  refactor to sneak in here.

---

## Ruling 1 — ai-chat lane admission module (IMPLEMENT — ticket `feat-283`)

**Files:** `apps/mastra/src/mastra/agents/seeker-route.ts` ·
`apps/mastra/src/mastra/ai-chat-history-route.ts` ·
`apps/mastra/src/mastra/index.ts` (registrations + the `seekerServiceKeys`
const) · `apps/mastra/src/mastra/seeker-route-isolation.test.ts` (the two
feat-250 pins) · a new lane module (suggested
`apps/mastra/src/mastra/ai-chat-lane-admission.ts`; exact name is the
implementer's).

**Problem (verified).** The lane's admission preamble — enable flag →
404 `{ error: "Not found" }`, then lane bearer → 401
`{ error: "Service bearer required" }`, with refusal bodies byte-identical
across all three routes — exists as two implementations (Correction 2), and
the two disagree on where the credential seam sits. The history handlers
source the lane CSV inside the handler (`readLaneServiceKeys` →
`parseServiceApiKeys(env.AI_CHAT_SERVICE_API_KEYS)`, KTD2's deliberate
"handler-owned sourcing"); `/forge-seeker` instead has its keys threaded
through `index.ts` (`serviceKeys: seekerServiceKeys`), so the pool-vs-lane
security invariant — pool keys must never reach conversation data (feat-250's
hard cutover) — is held by two regex source-pins in
`seeker-route-isolation.test.ts`, not by structure. feat-247's future routes
would hand-roll a third implementation.

**Design.** One lane-owned admission module scoped to the two genuinely
shared rungs: enable-flag gate (`isSeekerRouteEnabled`) → 404, lane-CSV
bearer (`isValidServiceBearer` against `AI_CHAT_SERVICE_API_KEYS`) → 401,
with key sourcing INSIDE the module as an injectable-for-tests seam
defaulting to the lane CSV. All three handlers call it;
`handleSeekerRouteRequest`'s required `serviceKeys` input becomes a defaulted
seam; the `index.ts` registrations pass no keys and the `seekerServiceKeys`
const disappears.

**Adjudicated requirements (each verified against the code):**

1. **The discriminating key-source test is the gate for deleting the pins.**
   The two feat-250 regex pins ("threads the lane-only seekerServiceKeys" and
   "derives seekerServiceKeys from the ai-chat lane CSV") reference a const
   this refactor deletes, so they MUST be removed — and removing them while
   replacing them with only fail-closed-when-unset coverage is a net security
   downgrade (Correction 4). The replacement test sets BOTH CSVs to distinct
   values and asserts pool-key → 401 and lane-key → admitted **through the
   DEFAULT sourcing path**, in the same PR that deletes the pins.
   Implementation note: `config/env.ts` snapshots `process.env` at module
   load, so the test needs `vi.stubEnv` + `vi.resetModules` + dynamic import
   (the established pattern in `config/env.test.ts`) — an injected
   `getServiceKeys` seam does NOT satisfy this requirement, because the seam
   bypasses the default source the test exists to pin.
2. **Scope is flag + bearer only.** The budget→fixed-reason mapping and the
   `user:`-prefix 403 stay per-route (Standing decisions; the send route
   admits anon/dogfood resources by design). Refusal order (flag before
   bearer) and both refusal bodies stay byte-identical to today's.
3. **Every other `seeker-route-isolation.test.ts` guard stays** — the
   `apiRoutes` region parse, the single `/forge-seeker` occurrence, the
   `handleSeekerRouteRequest` wiring pin, the `seekerAgent`
   exactly-twice-in-`index.ts` literal count, and the
   no-`seekerAgent`-inside-`apiRoutes` assertion. Only the two key-threading
   pins named in requirement 1 are replaced.
4. **`refuseUnlessAdmitted` and `readLaneServiceKeys` fold into the module**
   (the history handlers keep their injectable `getEnabled` /
   `getServiceKeys` test seams, now defaulting to the module's source, or
   drop them in favor of the module's own seam — implementer's choice).
5. **`assertAiChatServiceKeysDisjoint` is untouched** (Standing decision).
6. **KTD1 naming constraint carries to any new test/module text touching
   `index.ts`:** the isolation test counts literal `seekerAgent` occurrences
   in `index.ts` (exactly 2) and `/forge-seeker` occurrences in the
   `apiRoutes` region (exactly 1) — the slimmed registrations must not add
   either literal (comments included).
7. **`apps/mastra/CLAUDE.md` updates ride the same PR** — the env table's
   `AI_CHAT_SERVICE_API_KEYS` row and the "Service route (`POST
/forge-seeker`)" + "ai-chat history read surface" sections describe the
   current wiring and must reflect the module.

**Grep anchors:** `seekerServiceKeys`, `refuseUnlessAdmitted`,
`readLaneServiceKeys`, `isValidServiceBearer`, `parseServiceApiKeys`,
`Service bearer required`, `AI_CHAT_SERVICE_API_KEYS`,
`assertAiChatServiceKeysDisjoint`.

> **Amendment (2026-07-21, PR #NNNN):** implementation review added two guards
> beyond requirement 3's replace-only wording: (1) a "lane registrations inject
> no admission seams" source pin in `seeker-route-isolation.test.ts` (per-block
> over the enumerated lane routes, plus a parser-independent whole-source
> seam-token backstop that also covers future lane registrations) — an
> explicit `getServiceKeys`/`getEnabled` seam at a lane registration in
> `index.ts` would re-grant pool keys with every other test green (future lane
> routes, e.g. feat-247's, must NOT thread admission seams through
> registrations); and (2) a default-flag 404 handler companion in
> `ai-chat-lane-admission.test.ts` — a handler re-growing a local `getEnabled`
> default would bypass the `SEEKER_ROUTE_ENABLED` kill switch unnoticed.
> Nothing beyond the two named feat-250 pins was replaced or weakened; all
> seven requirements hold.

## Ruling 2 — Thread-ownership read-path resolver (IMPLEMENT, minimal — ticket `feat-284`)

**Files:** `apps/mastra/src/mastra/ai-chat-thread-ownership.ts` ·
`apps/mastra/src/mastra/ai-chat-history-route.ts` (replay handler) · their
test files.

**Problem (verified).** `authorizeAiChatThreadAccess` answers a write-path
question ("may this turn create-or-continue?"), so the replay handler must
compose three non-obvious facts around it, all currently living as comments
at the call sites: the gate's missing-thread branch is a write-path concept
that would admit a vanished thread as an empty-transcript success; its
`thread_limit` refusal is reachable on reads only when the thread is missing,
so the handler remaps it to `thread_not_found`; and `recall` must always
receive `resourceId` or the store's own ownership throw is disabled. The
handler also pays for the write shape at runtime (Correction 3): two
`getThreadById` reads per owned replay, three store queries per missing
thread.

**Design.** Deepen the ownership module with a second, read-path entry point
that resolves an **owned, existing** thread — or a fixed refusal — from a
single `getThreadById`: `null` → `thread_not_found`; owner mismatch →
`thread_forbidden`; owner match → ok. The ceiling branch (and therefore the
`thread_limit` → `thread_not_found` remap) **disappears from the read path
entirely** rather than moving. The replay handler becomes: admission preamble
→ resolver → `recall` + projection.

**Adjudicated requirements:**

1. **The always-pass-`resourceId` rule on `recall` STAYS a handler
   obligation** — deliberately. Absorbing `recall` would turn an ownership
   module into a read service. Keep the existing comment at the `recall`
   call site; the resolver's docstring should name this boundary.
2. **The fail-closed contract is untouched.** The resolver propagates
   `getThreadById`'s store-error throw (no try/catch inside it), so the
   handler's catch still maps outages to `store_failed` — never
   `thread_not_found`. `ai-chat-pg-failmode-contract.test.ts` is not
   modified.
3. **The wire contract is frozen.** Existing replay test scenarios keep their
   wire outcomes exactly: foreign owner → 403 `thread_forbidden`; missing
   thread → 404 `thread_not_found` (including the at-ceiling-resource
   fixture, which today routes through the gate's `thread_limit` and must
   still surface `thread_not_found`); store outage after admission → 500
   `store_failed`. Test internals may change (e.g. asserting `listThreads`
   is NOT called on the read path — the efficiency win made observable).
4. **Scope to exactly what replay needs today.** No delete/rename
   pre-design; feat-247's brainstorm extends the resolver when that ticket
   is picked up.
5. **The write-path `authorizeAiChatThreadAccess` is unchanged** — the send
   route keeps using it as-is, including the ceiling branch and its
   documented fail-OPEN posture.
6. **`apps/mastra/CLAUDE.md`'s "ai-chat history read surface" replay bullet
   updates in the same PR** (it currently narrates gate → existence check →
   recall).

**Grep anchors:** `authorizeAiChatThreadAccess`, `thread_limit`,
`thread_not_found`, `AiChatOwnershipMemory`, `write-path concept`,
`resourceId` (in the replay handler), `USER_RESOURCE_PREFIX`.

## Ruling 3 — ai-chat memory module extraction + keying policy (IMPLEMENT as ride-along — ticket `feat-285`)

**Files:** `apps/mastra/src/mastra/memory.ts` (two domains in one file) ·
`apps/mastra/src/mastra/agents/seeker-route.ts` (the titling-scope ternary) ·
importers `agents/seeker-agent.ts`, `ai-chat-history-route.ts`,
`ai-chat-retention.ts` · `memory.test.ts`.

**Problem (verified).** `memory.ts` hosts two domains that — per its own
header — "share nothing but this module and the connection string": the
ai-chat lane half (8 exports) and the experience-chat half (10 exports,
serving out-of-scope agents). And the lane's one real memory _policy_ —
signed-in-only titling, feat-241 KTD12 — is implemented as a ternary in
`seeker-route.ts` (`options: { generateTitle: false }` for non-`user:`
resources), away from `AI_CHAT_TITLE_MODEL` and the `""`-sentinel semantics
it belongs beside. A future lane route that forgets the override would title
junk threads on a third-party model.

**Trigger (calibrated — this is why it is a ride-along).** Only one route
builds a per-call memory config today; feat-247's delete/rename run no agent
turn, feat-209 adds no Mastra surface, feat-248 may never happen. The
forgotten-override bug class materializes only when a **second agent-turn
route** exists. Execute this ruling as a ride-along with the next PR that
materially touches `memory.ts`'s ai-chat half or adds a second agent-turn
route — do not schedule it as standalone work.

**Design.** Extract the ai-chat half into a lane-owned module (suggested
`apps/mastra/src/mastra/ai-chat-memory.ts`); the experience half stays in
`memory.ts` so out-of-scope consumers keep their imports. The new module
gains the per-call memory-keying policy helper: given `threadId` + resource,
return the `{ thread, resource }` memory config, with
`options: { generateTitle: false }` for non-`user:` resources.
`seeker-route.ts`'s ternary becomes a call.

**Adjudicated requirements:**

1. **`USER_RESOURCE_PREFIX` is imported from `ai-chat-thread-ownership.ts`,
   never re-declared.** That module declares itself the single mastra-side
   home of the resource contract; a second home would quietly violate the
   contract-locality it claims.
2. **KTD12 semantics carry verbatim:** the TOP-LEVEL `generateTitle` option
   key (the deprecated `threads.generateTitle` nesting throws mid-turn, not
   at construction), the `""` untitled sentinel, fire-and-forget timing, and
   `AI_CHAT_TITLE_MODEL` as a plain model-router string (a static
   `@ai-sdk/*` import trips the Mastra CLI bundler).
3. **Seam relocation only — zero behavior change.** Singletons,
   `__reset*ForTesting` hooks, lazy construction, and the backend-aware
   `buildAiChatMemory` seam carry as-is; `memory.test.ts`'s ai-chat cases
   move with the code.
4. **The header conventions split with the file:** the pool-arithmetic note
   splits per-module with cross-pointers, and the mirrored-not-imported-from-
   admin note carries to the new module's header.
5. **The retention purge keeps building over the persisted store**
   (`getAiChatStorage`, never the backend-resolved `getAiChatMemory`) — the
   import moves, the rule does not.

**Grep anchors:** `buildAiChatMemory`, `getAiChatStorage`,
`AI_CHAT_TITLE_MODEL`, `generateTitle: false`, `ai-chat-memory-storage`,
`USER_RESOURCE_PREFIX`, `AI_CHAT_SCHEMA_NAME`.

## Verification expectations (every PR in this body of work)

- `pnpm --filter @forge/mastra test` / `typecheck` / `lint` — all green; no
  existing suite deleted or skipped. `seeker-route-isolation.test.ts` stays
  green with only Ruling 1's two named pins replaced;
  `ai-chat-pg-failmode-contract.test.ts` is never modified.
- **Wire contracts frozen** (Standing decision): the SSE frame vocabulary,
  the history projections, and the admission refusal bodies are
  byte-identical before and after.
- **Real-service smoke** against a locally running Mastra instance
  (`MASTRA_STORAGE_BACKEND=memory` is the documented local mode): exercise
  `/forge-seeker` and both history routes through their gates — flag off →
  404, wrong/pool bearer → 401, lane bearer admitted. The operator's
  implementation prompt supplies the local run/bearer recipe
  (workspace-specific; not recorded here). Respect running processes: if a
  Mastra instance is already listening, it is the operator's — never kill or
  restart it.
- **Run `/ce-code-review` after implementation, before push, and resolve the
  actionable findings** — feat-283 touches an auth surface (a mandatory
  Tier-2 trigger).
- Amendments to this doc ride the same PR as the deviation (see protocol
  above).
- Tickets flip `in-progress` (+ lane README row) as the implementing
  session's first act; `complete` + `## Resolution` + README row land inside
  the arc's final PR (lane convention).
