---
title: "React StrictMode remount wedge — mount-effect cleanup mutates hook-lifetime refs without setup restore"
date: 2026-07-14
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
    jsdom,
    hydration,
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

- Under a StrictMode double-mount, the sidebar shows the history loading skeleton forever; no rows ever hydrate. Reproduced red-first by the test at `apps/chat/src/components/shell/app-shell.history.test.tsx:492` ("hydrates the sidebar under a StrictMode double-mount instead of wedging at loading").
- After the mount cycle, replay and send flows degrade too (aborted shared controller + stale `mountedRef`): covered red-first by `apps/chat/src/components/shell/app-shell.history.test.tsx:506` ("still replays and sends after a StrictMode mount cycle").
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

**4. Regression tests render under `<StrictMode>`** — the "Remount safety (dev StrictMode cycle)" describe at `apps/chat/src/components/shell/app-shell.history.test.tsx:491-528` (two tests: hydration doesn't wedge; replay + send still work after a mount cycle), via the harness's opt-in wrapper at `apps/chat/src/components/shell/app-shell-test-harness.tsx:22-29`.

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

   and a minimal regression test (full versions at `apps/chat/src/components/shell/app-shell.history.test.tsx:491-528`):

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

## Related Issues

- `docs/solutions/design-patterns/react-strictmode-dom-wrapping-widget-teardown-20260424.md` — the DOM-substrate sibling of this class: same `setup → cleanup → setup` trigger, same "cleanup mutation unpaired with setup restore" root-cause shape, but the poison lives in a detached DOM node instead of hook-lifetime refs. Its Prevention test pattern (render under `<StrictMode>`, assert the second setup is healthy) is the template this entry's test angle instantiates for `apps/chat`.
- `docs/solutions/best-practices/synchronous-guard-run-to-completion-false-positive-20260615.md` — its Rule A states the mechanism this class rides on ("StrictMode's simulated remount preserves both useState and useRef, it does not reset them"), and its worked example analyzed this same file's `send()` back when it was a synchronous stub. Its time-bound disclaimer — the non-bug verdict was slated for re-verification when the real async Mastra call landed — has now triggered — `use-conversations.ts` is async with a per-conversation `AbortController` map — making this doc the current guidance for that file.
- `docs/solutions/best-practices/rn-animated-react18-cleanup-review-false-positives-20260615.md` — its Rule 2 calls `mountedRef` guards dead code under React 18 _when used solely to silence setState-after-unmount_. Not a contradiction here: this hook's `mountedRef` is a stale-result/abort-discard correctness guard (that doc's own carve-out), and this entry adds the StrictMode corollary Rule 2 never covers — IF such a ref exists, setup must restore what cleanup mutates.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — test-discipline instance: a jsdom suite that never renders under `<StrictMode>` structurally cannot exercise the `setup → cleanup → setup` mechanism, so it passes while the hook wedges in dev.
- `docs/solutions/best-practices/rtl-user-event-vitest-fake-timers-migration-20260625.md` — the apps/chat jsdom harness conventions (RTL + user-event + `shouldAdvanceTime` fake timers) the StrictMode-rendered suite builds on.
