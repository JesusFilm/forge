---
title: "React StrictMode remount wedge — mount-effect cleanup mutates hook-lifetime refs without setup restore"
date: 2026-07-14
last_updated: 2026-07-22
category: logic-errors
module: apps/chat
problem_type: logic_error
component: frontend_stimulus
symptoms:
  - "Chat sidebar server-history hydration wedged at the loading state forever under a dev StrictMode double-mount (reproduced only in a jsdom StrictMode render; the real Next 16 dev server did not reproduce — a latent-until-remount class)"
  - "Fired-once hydration effect never refires after StrictMode's setup-cleanup-setup cycle because hook-lifetime refs survive on the same hook instance (only a real unmount gets a fresh instance)"
  - "History fetch results silently discarded — the mount cleanup left mountedRef false and the hook reused an already-aborted AbortController on remount"
  - "Re-arming the fired-once effect by reading a state-mirroring ref in cleanup fails — no re-render lands between StrictMode's setup and cleanup, so the ref still holds the pre-setState snapshot"
root_cause: logic_error
resolution_type: code_fix
severity: medium
related_components:
  - testing_framework
tags:
  [
    react,
    strictmode,
    useeffect,
    hook-lifetime-refs,
    abortcontroller,
    remount-safety,
    renderhook,
    usesyncexternalstore,
  ]
---

# React StrictMode remount wedge — mount-effect cleanup mutates hook-lifetime refs without setup restore

## Problem

A React mount effect whose **cleanup mutates hook-lifetime refs** — a `mountedRef = false` flag, an aborted-but-still-referenced `AbortController`, a fired-once hydration latch — without the **setup restoring them** wedges under React StrictMode's dev `setup → cleanup → setup` cycle. StrictMode remounts the **same hook instance**: state and refs survive the simulated unmount, so the refs come out of the cycle poisoned. A _real_ unmount discards the instance and re-initializes every ref, which is exactly why this class hides in production and in plain test renders.

Concrete instance (feat-241, chat server-history sidebar; shipped with the feat-241 branch, unmerged as of this writing): `useConversations` in `apps/chat/src/lib/use-conversations.ts` gained post-mount history hydration. The pre-fix shape had

- a mount effect whose cleanup set `mountedRef.current = false` and aborted the hook-lifetime history `AbortController`, with no setup-side restore;
- a fired-once `hydratedRef` boolean latched **when the fetch started**;
- a lazily-minted controller (`historyAbortRef.current ??= new AbortController()`) that, once aborted, kept being handed out by `??=`.

Under a StrictMode mount cycle: setup 1 fires the first-page fetch and latches `hydratedRef`; the synchronous cleanup aborts the fetch and flips `mountedRef` to `false`; setup 2 restores nothing and the latched `hydratedRef` blocks the refetch. The aborted fetch's callback drops its result on the `!mountedRef.current` guard, so `history.phase` stays `"loading"` forever, and every later list/replay fetch inherits the already-aborted signal via `??=`. The same stale-`false` `mountedRef` also made `clearReply` (`apps/chat/src/lib/use-conversations.ts:278-289`, gate at `:282`) skip its pending/streaming state sync — after the first reply the "Replying" pulse and disabled composer stick.

Caught pre-merge as the P1 correctness finding (confidence 75) in feat-241's pre-push Tier-2 `ce-code-review`; outcome `applied` with red-first regression tests.

**Honesty caveat — latent-until-remount, not a live dev-server breakage.** In this session the real Next 16 dev server did **not** reproduce the wedge (`apps/chat/next.config.ts` sets no `reactStrictMode`, which defaults StrictMode on for App Router dev, yet the double-effect cycle did not manifest in the browser smoke — why was not conclusively established). The jsdom `<StrictMode>` render **did** reproduce it deterministically. Treat the class as latent until _any same-instance remount_ of the hook: StrictMode dev cycles, Fast Refresh, and the Suspense/`<Activity>`-style show-hide cycles that StrictMode's double-invoke exists to rehearse. (Key-driven remounts mint a fresh hook instance with fresh refs and are unaffected — which is precisely why the bug hides everywhere else.)

## Symptoms

- Under a StrictMode double-mount, the sidebar shows the history loading skeleton forever; no rows ever hydrate. Reproduced red-first by the test at `apps/chat/src/components/shell/app-shell.history.test.tsx:534` ("hydrates the sidebar under a StrictMode double-mount instead of wedging at loading").
- After the mount cycle, replay and send flows degrade too (aborted shared controller + stale `mountedRef`): covered red-first by `apps/chat/src/components/shell/app-shell.history.test.tsx:548` ("still replays and sends after a StrictMode mount cycle").
- Nothing throws. No console error. The fetch is aborted and its result silently discarded — the UI just never leaves its transitional state.
- Production builds, plain (non-StrictMode) jsdom renders, and — in this session — even the real dev server showed nothing. The entire pre-existing suite was green while the class sat latent.

## What Didn't Work

**Re-arming the fired-once latch in cleanup by reading a state-mirroring ref.** The "obvious" targeted fix (reconstructed; per this session's debugging it was tried and the red StrictMode test stayed red):

```tsx
// FAILED FIX (reconstructed anti-pattern — do not copy)
useEffect(() => {
  if (!seekerEnabled || hydratedRef.current) return
  hydratedRef.current = true
  startHistoryFirstPage() // setHistory({ phase: "loading" }) + fetch
  return () => {
    // Intent: re-arm only if the first page was still in flight.
    if (historyRef.current.phase === "loading") hydratedRef.current = false
  }
}, [seekerEnabled])
```

This fails because `historyRef` is a **state mirror assigned during render** (`historyRef.current = history`, `apps/chat/src/lib/use-conversations.ts:234-235`). StrictMode runs `setup → cleanup → setup` synchronously within one commit — **no re-render lands in between** — so when the cleanup reads the mirror it still holds the _pre-setState_ snapshot: phase `"idle"`, not `"loading"`. The re-arm condition is false, the latch stays set, the wedge persists. General law: **cleanup-time decisions keyed on state-mirroring refs read stale data during the StrictMode cycle** — the mirror only advances when a re-render commits, and the cycle commits none.

**Relying on `mountedRef` alone to discard stale async results.** By the time the aborted first fetch's callback runs, setup 2 has already restored `mountedRef.current = true` — so a `!mountedRef.current` guard alone would let the aborted fetch's result (or its error path) race the second, live fetch. The discard must additionally key on the fetch's **own** controller: `controller.signal.aborted` (see Solution).

**Expecting the dev-server browser smoke to catch it.** It didn't this session (see the honesty caveat above). Only the jsdom `<StrictMode>` render reproduced the wedge.

## Solution

Four coordinated pieces on the feat-241 branch — the first three in `apps/chat/src/lib/use-conversations.ts`, the fourth in the shell test suite and harness.

**1. Setup restores everything cleanup mutates; cleanup aborts AND nulls the hook-lifetime controller** (`:242-259`):

```ts
useEffect(() => {
  const controllers = controllersRef.current
  // Restore what the cleanup below mutates: under dev StrictMode React runs
  // setup -> cleanup -> setup on the SAME hook instance, so without this the
  // remounted tree would keep the poisoned refs and never apply state again.
  mountedRef.current = true
  return () => {
    // Abort in-flight streams on unmount so their async callbacks don't fire
    // setState after teardown; same for in-flight history/replay fetches.
    mountedRef.current = false
    for (const controller of controllers.values()) controller.abort()
    controllers.clear()
    historyAbortRef.current?.abort()
    // Null it so a remount lazily mints a FRESH controller instead of
    // reusing the aborted one.
    historyAbortRef.current = null
  }
}, [])
```

Nulling matters because the controller is minted lazily (`:237-240`):

```ts
function historyController(): AbortController {
  historyAbortRef.current ??= new AbortController()
  return historyAbortRef.current
}
```

Without the `= null`, `??=` keeps returning the aborted controller after the cycle, poisoning every later list/replay fetch.

**2. The fire-once hydration guard keys on the phase ref, not a boolean latch** (`:412-417`, comment at `:409-411`):

```ts
// Hydration fires post-mount under a full gate grant (KTD9), guarded on the
// phase REF, not a fired-once flag: StrictMode's cleanup aborts the first
// fetch pre-render, so only a still-"idle" phase lets a remount start over.
useEffect(() => {
  if (!seekerEnabled || historyRef.current.phase !== "idle") return
  startHistoryFirstPage()
  // Intentionally keyed on the (deploy-static) flag only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [seekerEnabled])
```

The very staleness that broke the failed fix is load-bearing here, in the safe direction: within the synchronous StrictMode cycle no re-render commits, so setup 2 still reads the `"idle"` snapshot and **re-fires the fetch**. Once React commits a render after `startHistoryFirstPage`'s `setHistory({ ...HISTORY_IDLE, phase: "loading" })` (`:405`), the mirror leaves `"idle"` and the effect can never double-fire. A real remount gets a fresh instance whose state re-initializes to `HISTORY_IDLE`, re-arming naturally.

**3. Async callbacks discard results whose own controller was aborted (or when unmounted)** — the history page fetch (`:373-379`):

```ts
function runHistoryPageFetch(page: number) {
  const controller = historyController()
  void (async () => {
    const result = await fetchHistoryPage({ page, signal: controller.signal })
    // A result from an aborted fetch (unmount, or StrictMode's dev
    // mount-cycle) must never apply state — the next mount owns its own.
    if (!mountedRef.current || controller.signal.aborted) return
    ...
```

and identically in the replay fetch (`:455`): `if (!mountedRef.current || controller.signal.aborted) return`. The signal check is per-fetch (closes over `controller`), so the aborted generation-1 fetch can never apply state over the live generation-2 fetch even though `mountedRef` is `true` again.

**4. Regression tests render under `<StrictMode>`** — the "Remount safety (dev StrictMode cycle)" describe at `apps/chat/src/components/shell/app-shell.history.test.tsx:533-570` (two tests: hydration doesn't wedge; replay + send still work after a mount cycle), via the harness's opt-in wrapper at `apps/chat/src/components/shell/app-shell-test-harness.tsx:22-29`.

Run: `pnpm --filter @forge/chat test`

## Why This Works

StrictMode's dev-only double-invoke simulates unmount/remount **on the same component instance**: `useState`/`useRef` values are preserved across the `setup → cleanup → setup` cycle, and the whole cycle runs synchronously within one commit — no re-render, no ref-mirror update, no state application in between. Two consequences drive everything above:

1. **Hook-lifetime refs are the only carrier of poison across the cycle.** A real unmount discards the instance (fresh refs); StrictMode does not. So the setup/cleanup pair must be **idempotent over the cycle**: setup restores exactly what cleanup mutates (`mountedRef.current = true`), and anything cleanup consumes irreversibly (an aborted `AbortController`) must be dropped (`= null`) so the next setup mints a fresh one instead of inheriting a dead one.
2. **Render-committed snapshots are frozen for the whole cycle.** That kills any cleanup-side re-arm keyed on a state mirror (it reads the pre-setState value) — but it makes a _setup-side_ guard on the same mirror correct: the still-`"idle"` snapshot is precisely the signal "no fetch from this instance has ever committed state", which is the right condition for the remounted effect to start over. The phase only durably leaves `"idle"` when a fetch's state application survives to a committed render — an aborted first fetch never gets to block the second.

Piece 3 closes the remaining race: with `mountedRef` restored to `true` by setup 2, "am I mounted" no longer distinguishes the dead generation-1 fetch from the live generation-2 fetch — only each fetch's own `controller.signal.aborted` does.

## Prevention

Checklist for any hook with mount effects + hook-lifetime refs (grep: `useRef` + `useEffect(.*=> {` cleanups that assign `.current`):

1. **Every mount effect whose cleanup mutates a hook-lifetime ref must restore it in setup.** Audit the cleanup line by line; each mutation needs a setup-side inverse (`mountedRef.current = true`) or a drop-and-remint (`abortRef.current = null` + lazy `??= new AbortController()`).
2. **Never decide anything in cleanup by reading a state-mirroring ref.** `ref.current = state` assigned during render holds the last _committed_ snapshot; StrictMode's cycle commits nothing between setup and cleanup, so the read is stale by construction. Move the decision to setup, keyed on a value that only advances when state actually commits.
3. **Fire-once guards must be re-enterable by a remounted setup.** A boolean latched at operation _start_ wedges; a phase guard that leaves its initial value only via committed state does not.
4. **Async callbacks discard on their own controller's `signal.aborted`, not on a mounted flag alone.** After a remount the flag is true again; only the per-fetch signal identifies the dead generation.
5. **Render at least one suite per stateful hook/shell under `<StrictMode>`.** Production builds don't double-mount, plain jsdom renders don't either, and (per this session) even the real dev server may not show it — the jsdom `<StrictMode>` render is the only deterministic detector in this repo's toolchain. Harness pattern (`apps/chat/src/components/shell/app-shell-test-harness.tsx:22-29`):

   ```tsx
   import { StrictMode } from "react"
   import { render } from "@testing-library/react"

   export function renderShell(
     seekerEnabled = false,
     opts: { strictMode?: boolean } = {},
   ) {
     const shell = <AppShell seekerEnabled={seekerEnabled} />
     view = render(opts.strictMode ? <StrictMode>{shell}</StrictMode> : shell)
     container = view.container
   }
   ```

   and a minimal regression test (full versions at `apps/chat/src/components/shell/app-shell.history.test.tsx:533-570`):

   ```tsx
   it("hydrates under a StrictMode double-mount instead of wedging", async () => {
     renderSeeker(() => [], {
       listFor: () => ({ threads: [ALPHA] }),
       strictMode: true,
     })
     await waitFor(() => expect(navRowTitles()).toContain("Alpha thread"))
     expect(
       getConversationNav().querySelector('[data-history="loading"]'),
     ).toBeNull()
   })
   ```

   Verify: `pnpm --filter @forge/chat test`

## Detection pitfall (2026-07-22, feat-281): `renderHook` needs RTL's `reactStrictMode` option — a custom `<StrictMode>` wrapper never doubles the effect cycle

Prevention item 5 above proves the harness pattern for **whole-tree** renders:
`render(opts.strictMode ? <StrictMode>{shell}</StrictMode> : shell)`
(`apps/chat/src/components/shell/app-shell-test-harness.tsx:22-29`) genuinely
produces `setup → cleanup → setup`, because `<StrictMode>` wraps the
**element itself**. The trap is RTL's `wrapper` **option**: a wrapper
component rendering `<StrictMode>` around `children` double-invokes the
hook's `useState`/`useMemo` initializers (proving StrictMode is "on") but the
**effect cycle stays single-invoke** — under `render` AND `renderHook` alike:
`useEffect`'s setup fires once, no cleanup, no second setup. `render()`
escapes only where the harness wraps the element directly (the pattern
above); `renderHook` has no element to wrap, so its **only** correct
mechanism is its `reactStrictMode: true` option. A StrictMode suite built on
the `wrapper` option therefore renders green while never exercising the
re-arm path it exists to catch — exactly the "mocked-shape-vs-real-contract"
trap this doc's own Related Issues list already names, now instantiated
inside the detection tooling itself.

Empirical logs from the feat-281 session + its doc review (React 19.x,
`@testing-library/react` 16.x, vitest jsdom), captured from an instrumented
probe hook's setup/cleanup/init:

- `renderHook(fn, { wrapper: StrictModeWrapper })` → effect log `["setup"]`
  (init log `["init", "init", "setup"]` — the state initializer doubles, the
  effect does not).
- `render(<Probe />, { wrapper: StrictModeWrapper })` → effect log
  `["setup"]` — the `wrapper` OPTION is equally vacuous under `render`; the
  ecosystem-standard provider slot is exactly where this trap hides.
- `renderHook(fn, { reactStrictMode: true })` → effect log
  `["setup", "cleanup", "setup"]` — the real double-invoke.
- `render(<StrictMode><Probe /></StrictMode>)` → effect log
  `["setup", "cleanup", "setup"]` — element-wrapping works, which is why the
  harness pattern looks (wrongly) like it should generalize to the `wrapper`
  option.

**Fix: use `renderHook`'s own `reactStrictMode: true` option, never a custom
wrapper, for any StrictMode coverage of a hook under `renderHook`.** The
corrected suite pins this as its header contract
(`apps/chat/src/lib/use-conversations.strictmode.test.tsx:1-3`):

```tsx
// StrictMode-rendered adapter coverage (feat-281): pins the re-arm cycle on
// ONE session + the cached-getSnapshot contract. Needs RTL reactStrictMode,
// NOT a <StrictMode> wrapper — see apps/chat/CLAUDE.md's renderHook gotcha.
```

and a single shared options object reused by every `renderHook` call in the
file (`apps/chat/src/lib/use-conversations.strictmode.test.tsx:11`):

```ts
const strict = { reactStrictMode: true } as const
```

passed as `renderHook(() => useConversations(true), strict)` at each call
site (e.g. `:82`, `:129`).

Prevention item 5's checklist item is unchanged for **whole-tree** suites
(`app-shell-test-harness.tsx`'s pattern — wrapping the element — is correct
as written); this pitfall applies wherever StrictMode is attached via the
`wrapper` OPTION, whichever entry point is used. Grep signal for future
audits: any file passing a StrictMode-bearing component through a
`wrapper:` option — to `renderHook` OR `render` — is very likely a vacuous
StrictMode suite; `grep -rn "wrapper" apps/chat/src --include="*.test.tsx" |
grep -i strictmode` and check each hit uses element-wrapping or
`reactStrictMode: true` instead.

## Boundary (2026-07-20, feat-269): the prescription is per-effect — cleanup-less rerender-driven trackers gain nothing from StrictMode

Prevention item 5 ("render at least one suite per stateful hook/shell under `<StrictMode>`") targets this doc's actual wedge mechanism — a mount effect whose **cleanup mutates hook-lifetime refs without the setup restoring them**, poisoned across the `setup → cleanup → setup` cycle. It does **not** extend to a cleanup-less effect whose interesting transition is **rerender-driven**. For those, a StrictMode render exercises only the mount double-invoke — never the transition under test — so the suite passes identically with or without any regression: test theater, not detection.

Concrete instance (feat-269; uncommitted on `feat/chat-sources-presentation`, PR not yet opened): the finalize-scroll effect in `apps/chat/src/components/chat/chat.tsx:126-144` tracks the previous in-flight assistant id in a hook-lifetime ref (`prevStreamingIdRef`, `:112`), mutated only in the effect **body** — no cleanup is returned:

```tsx
useLayoutEffect(() => {
  const el = logRef.current
  if (!el) return
  const prevStreamingId = prevStreamingIdRef.current
  prevStreamingIdRef.current = streamingMessageId
  if (prevStreamingId !== null && streamingMessageId === null) {
    const turn = el.querySelector(
      `[data-message-id="${CSS.escape(prevStreamingId)}"]`,
    )
    if (turn) {
      // Align the answer's top to the scrollport top (clamped by the
      // browser when there isn't enough content below to fill the view).
      el.scrollTop +=
        turn.getBoundingClientRect().top - el.getBoundingClientRect().top
      return
    }
  }
  el.scrollTop = el.scrollHeight
}, [conversation.messages, pending, conversation.id, streamingMessageId])
```

The finalize branch fires only on a **rerender** where `streamingMessageId` transitions non-null → null. StrictMode double-invokes effects at **mount only, with the same props both times**: run 1 sees `prev === null` (the ref's initial value) and stores the current id; run 2 reads back exactly what run 1 stored, so `prev === streamingMessageId` — the finalize condition (`prev !== null && current === null`) is unsatisfiable inside the cycle. The double-invoke self-neutralizes, and with no cleanup there is no mutation for a setup to restore — the poisoning mechanism this doc documents does not exist here. The discriminating test for this effect shape is a **`rerender` with changed props**, which the colocated suite already performs (`apps/chat/src/components/chat/chat.test.tsx:77-206` — finalize, error-finalize, streaming-growth, and conversation-switch transitions, each asserting WHICH scroll the effect performs).

Refined rule for item 5, applied per effect: ask — **does this effect return a cleanup that mutates hook-lifetime state, arm anything at mount** (a fetch, a fired-once latch, a shared controller), **or perform non-idempotent mount-time work in its body** (appending a node, incrementing a hook-lifetime counter, emitting an event — the double-fire dual of the never-fire wedge)? If any: the prescription applies in full. The exemption covers only a cleanup-less previous-value tracker whose mount-time fall-through is idempotent — here, assigning `el.scrollTop = el.scrollHeight` twice in a row is a no-op, and that idempotence is load-bearing for the exemption. StrictMode coverage may still be warranted for OTHER hooks in the same shell; the boundary is per-effect, not per-file.

The exemption attaches to this effect's current shape (cleanup-less, idempotent mount body), never to `chat.tsx` or its suite as a standing verdict: re-run the trigger question whenever this effect gains a cleanup or mount-armed work, or the rendered tree gains any new effect. A component suite may skip StrictMode only while EVERY effect in its rendered tree — child components and hooks included — is individually exempt.

Session history (feat-269 review, 2026-07-20): four reviewers pattern-matched this doc and recommended a StrictMode-wrapped test of the finalize path; an independent validator rejected the recommendation with exactly the self-neutralization trace above, and two independent hand-traces concurred. The over-trigger is worth naming: the Prevention list can read as "any hook-lifetime ref near an effect ⇒ StrictMode suite" — the trigger is the cleanup-side mutation, not the ref.

## Corollary (2026-07-22, feat-281): synchronous external stores need explicit rollback — this doc's ref-lag mechanic inverts

This doc's core mechanism (see "Why This Works" above) depends on a specific
timing fact: within one StrictMode `setup → cleanup → setup` cycle, **no
re-render lands in between**, so a state-mirroring ref read in cleanup is
stale — it still holds the pre-cleanup snapshot. That staleness is what made
the fired-once guard safe to key on a ref in the original `useState`-based
`use-conversations.ts` hook (Solution piece 2 above): the still-`"idle"`
snapshot at setup 2 was the correct "nothing has committed yet" signal even
though cleanup had already run.

feat-281 (PR 1; uncommitted in the working tree as of this writing) extracted
every conversation machine out of that hook into a framework-agnostic,
synchronous external store —
`createConversationSession` in `apps/chat/src/lib/conversation-session.ts` —
consumed via `useSyncExternalStore` from a thin adapter
(`apps/chat/src/lib/use-conversations.ts`). That move **inverts the timing
fact the mechanism above relies on**. A `useSyncExternalStore`-backed store
has no render-frame lag: state the store mutates in `deactivate()` (called
from the mount effect's cleanup, `apps/chat/src/lib/use-conversations.ts:71`)
is immediately visible to `getSnapshot()` — there is no ref mirror updated
only on commit, because there is no commit gating visibility at all. A naive
port of the old fired-once-on-`"idle"` guard into this shape would therefore
wedge for the opposite reason the old code worked: `deactivate()` aborting a
fetch mid-flight leaves `history.phase` at `"loading"`, `activate()`'s guard
(`history.phase === "idle"`) reads that live "loading" value on the second
setup, sees it's not `"idle"`, and never re-fires — silently wedged with its
own fetch already aborted.

**The discipline this corollary adds: when state moves into a synchronous
external store, the OLD "let staleness carry you through" trick is gone, so
`deactivate()` must EXPLICITLY roll back every piece of state that only an
in-flight (now-aborted) operation could ever complete — restoring the store
to a state from which `activate()` on the SAME instance is idempotent and
re-arms.** Read the coordinated pair at the current tree:

`deactivate()` (`apps/chat/src/lib/conversation-session.ts:755-782`) —
aborts every controller (`:758-764`, including nulling `historyAbort` so the
next activation mints a fresh one, not the aborted one — the same
null-and-remint discipline as this doc's original Solution piece 1), then
explicitly rolls back the three states only an in-flight fetch could have
advanced (`:765-778`):

```ts
// Roll back every state only an (aborted) in-flight fetch could complete,
// so activate() on the SAME instance re-arms instead of wedging — the
// StrictMode setup → cleanup → setup contract.
if (history.phase === "loading") {
  history = HISTORY_IDLE
} else if (history.loadingMore) {
  history = { ...history, loadingMore: false }
}
conversations = conversations.map((c) =>
  c.replay === "loading" ? { ...c, replay: "idle" } : c,
)
// Safe to clear even with settles pending: a stale finally's delete is a
// no-op, and the sync "loading" state guards against a double fetch.
replayInFlight.clear()
```

History-loading reverts to `HISTORY_IDLE`, an in-flight
load-more clears its flag, any conversation whose replay was mid-fetch reverts
`"loading"` → `"idle"`, and the single-flight `replayInFlight` set is cleared
so the reverted `"idle"` replay states are re-enterable rather than
permanently blocked by a guard keyed on `replayInFlight.has(id)`.

`activate()` (`apps/chat/src/lib/conversation-session.ts:742-753`) is then
the same fire-once-on-idle shape as the original hook, but now correctly
re-armed because `deactivate()` did the rollback the old ref-lag used to do
for free:

```ts
function activate() {
  active = true
  // Hydration fires on activation under a full gate grant (KTD9), guarded on
  // the live phase: only a still-"idle" phase starts over, so the StrictMode
  // cycle re-arms (deactivate rolled "loading" back) without double-fetching.
  if (deps.seekerEnabled && history.phase === "idle") {
    startHistoryFirstPage()
  }
  // Re-arm the active row's replay if deactivation rolled it back mid-fetch
  // (dev-only paths); at first activation the active row is local → no-op.
  maybeStartReplay()
}
```

**Generalized rule:** the mechanism in this doc's "Why This Works" section
(stale-ref-mirror-as-free-idempotence-signal) is specific to **React-owned
state read through a ref that only updates on committed render** — `useRef`
mirrors, `useState` closures. It does **not** carry over to any store whose
snapshot is read synchronously and mutated outside the render cycle
(`useSyncExternalStore` + a plain-object/class store, a Zustand/Redux-style
store, a module-singleton cache). For that shape, treat `deactivate()` (or
whatever the store's teardown hook is called) as fully responsible for
restoring a re-enterable state on its own — audit it exactly like this doc's
original Prevention item 1 audits a mount effect's cleanup, but against the
STORE's teardown method instead of a `useEffect` cleanup: every state an
in-flight, now-aborted operation could still be "in the middle of" needs an
explicit revert, not an assumed one. The regression coverage for this shape
lives in the `renderHook`-based suite from the Detection pitfall above
(`apps/chat/src/lib/use-conversations.strictmode.test.tsx`'s "hydrates
history through the cycle: an aborted first fetch re-arms exactly one
refetch" test, `:53-94`), which asserts on the actual fetch call count and
each call's `AbortSignal` state — not just on the absence of a wedge — so a
regression that re-fires zero times (wedge) or three-plus times (runaway
re-fetch loop) both fail it.

## Related Issues

- `docs/solutions/design-patterns/react-strictmode-dom-wrapping-widget-teardown-20260424.md` — the DOM-substrate sibling of this class: same `setup → cleanup → setup` trigger, same "cleanup mutation unpaired with setup restore" root-cause shape, but the poison lives in a detached DOM node instead of hook-lifetime refs. Its Prevention test pattern (render under `<StrictMode>`, assert the second setup is healthy) is the template this entry's test angle instantiates for `apps/chat`.
- `docs/solutions/best-practices/synchronous-guard-run-to-completion-false-positive-20260615.md` — its Rule A states the mechanism this class rides on ("StrictMode's simulated remount preserves both useState and useRef, it does not reset them"), and its worked example analyzed this same file's `send()` back when it was a synchronous stub. Its time-bound disclaimer — the non-bug verdict was slated for re-verification when the real async Mastra call landed — has now triggered — `use-conversations.ts` is async with a per-conversation `AbortController` map — making this doc the current guidance for that file.
- `docs/solutions/best-practices/rn-animated-react18-cleanup-review-false-positives-20260615.md` — its Rule 2 calls `mountedRef` guards dead code under React 18 _when used solely to silence setState-after-unmount_. Not a contradiction here: this hook's `mountedRef` is a stale-result/abort-discard correctness guard (that doc's own carve-out), and this entry adds the StrictMode corollary Rule 2 never covers — IF such a ref exists, setup must restore what cleanup mutates.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — test-discipline instance: a jsdom suite that never renders under `<StrictMode>` structurally cannot exercise the `setup → cleanup → setup` mechanism, so it passes while the hook wedges in dev.
- `docs/solutions/best-practices/rtl-user-event-vitest-fake-timers-migration-20260625.md` — the apps/chat jsdom harness conventions (RTL + user-event + `shouldAdvanceTime` fake timers) the StrictMode-rendered suite builds on.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`
  — a second instance of the same meta-pattern, this time in the DETECTION
  TOOLING itself: a `renderHook` StrictMode suite built with a custom
  `<StrictMode>` wrapper (instead of RTL's `reactStrictMode` option) passes
  vacuously because the wrapper never exercises the effect double-invoke it
  looks like it should. See this doc's Detection pitfall (2026-07-22,
  feat-281).
- `apps/chat/src/lib/conversation-session.ts` (feat-281, PR 1 — uncommitted
  as of this writing) — the synchronous-external-store corollary
  (2026-07-22): when a hook's state moves into a `useSyncExternalStore`
  store, the ref-lag this doc's core mechanism relies on inverts, and the
  store's `deactivate()` must explicitly roll back every in-flight-only state
  for `activate()` to re-arm on the same instance.
