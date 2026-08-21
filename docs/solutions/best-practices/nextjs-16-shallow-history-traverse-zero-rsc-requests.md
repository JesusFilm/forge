---
title: "Next 16 shallow-history traverse: the restore path exists in source, and fired zero RSC requests here"
date: "2026-08-19"
category: best-practices
module: apps/chat
problem_type: best_practice
component: frontend_stimulus
severity: medium
applies_when:
  - "Writing URLs with shallow history.pushState/replaceState under the Next App Router"
  - "Claiming that back/forward over shallow entries costs (or does not cost) a server request"
  - "Recording a framework-behavior claim that a future version bump can invalidate"
  - "Bumping Next.js in an app that owns its own history entries"
tags:
  - next-app-router
  - history-api
  - pushstate
  - popstate
  - rsc
  - force-dynamic
  - empirical-mechanism-claim
  - browser-verification
---

# Next 16 shallow-history traverse: the restore path exists in source, and fired zero RSC requests here

## Context

feat-209 gave `apps/chat` per-conversation URLs. In-app selection writes
`/c/<id>` through Next's patched `history.pushState` / `replaceState` — a
shallow write, chosen so the shell never remounts and an in-flight stream never
aborts. A real `force-dynamic` `/c/[id]` route exists, but only as the
deep-link entry.

That design raised one open cost question: **what does Back/Forward over those
shallow entries cost the server?** Each `/c/<id>` render re-resolves the seeker
gate and emits a `[seeker-gate]` log line, so one RSC request per traverse step
would be a real, recurring, per-user-keystroke server cost.

The question was answered twice, in opposite directions, and both answers are
true. That is why this note exists.

The planning pass first asserted the traverse was a no-op — zero RSC requests —
on the strength of the shallow-pushState mechanism alone. An adversarial
doc-review persona, reading Next's source, found the restore path that spawns
dynamic requests and contradicted the claim outright. The plan was then edited
to stop asserting either outcome and to **require a measurement** in its
browser matrix instead. (session history)

## Guidance

**Keep both halves of an empirical framework claim in the same sentence: the
source path exists, and it did not fire in the measured configuration. Either
half alone is misleading.**

### The source half — the restore path is real

The feat-209 plan's KTD1 records it
(`docs/plans/2026-08-18-2122-feat-chat-per-conversation-urls-plan.md:95`):

> Next's own popstate listener coexists and ours drives the store, but the
> traverse is NOT assumed free: the 16.2.4 restore path (`restore-reducer` →
> `startPPRNavigation` under `FreshnessPolicy.HistoryTraversal` →
> `spawnDynamicRequests`, falling back to a hard navigation when the task is
> null) can issue one dynamic RSC request to the restored `/c/<id>` per
> back/forward step on a `force-dynamic` route — each re-running the gate
> resolution and emitting a `[seeker-gate]` line.

Every named symbol is present in the installed `next@16.2.4`, in exactly that
arrangement (read 2026-08-19 from
`apps/chat/node_modules/next/dist/client/components/router-reducer/`):

- `apps/chat/node_modules/next/dist/client/components/router-reducer/reducers/restore-reducer.js:43` (installed package, not a tracked file) calls `startPPRNavigation(...)` with
  `FreshnessPolicy.HistoryTraversal`.
- `restore-reducer.js:44-45` (same installed file) — `if (task === null) return
completeHardNavigation(state, restoredUrl, 'replace')`: the hard-navigation
  fallback the plan names (snippets here elide the compiled CommonJS interop
  wrapper `(0, _mod.fn)(...)`; symbols and lines are exact).
- `restore-reducer.js:47` (same installed file) calls `spawnDynamicRequests(task,
restoredUrl, restoredNextUrl, FreshnessPolicy.HistoryTraversal, …)`.
- `ppr-navigations.js:71` (same installed directory) / `:817` define those two functions; `:54` defines
  `FreshnessPolicy.HistoryTraversal`.

So the plan's reading is not a guess, and the doc-reviewer who raised it was
right about the code.

**And the deciding branch — read one call frame deeper — makes the zero
source-determined, not merely observed.** The restore path RUNS on every
traverse step (popstate over an `__NA` entry dispatches `ACTION_RESTORE`
unconditionally — `app-router.js:283-298`), and `spawnDynamicRequests` IS
reached — then returns at its first branch because the task carried no
dynamic-request tree: for `FreshnessPolicy.HistoryTraversal` (freshness case 2) the cache-node walk sets `shouldRefreshDynamicData = false` and reuses the
existing cache node with no dynamic request (`ppr-navigations.js:131-165`),
so the request tree comes back null and `spawnDynamicRequests` early-returns
on `dynamicRequestTree === null` — the code's own comment: "This navigation
was fully cached. There are no dynamic requests to spawn." (`:826-831`). The
zero therefore rests on two structural preconditions: (a) the restored
`__PRIVATE_NEXTJS_INTERNALS_TREE` matches the live tree (guaranteed for
entries the patched `pushState`/`replaceState` wrote, which copy the current
tree into each shallow entry), and (b) every segment of that tree still has
a cache node. A traverse step is billed only when one of those fails.

### The measurement half — zero, in this configuration

Measured **2026-08-19** against **`next@16.2.4`**, `apps/chat` **production
build** (`next build` + `next start`, never `next dev`), **headless Chromium**:

Back/forward traversal over shallow `/c/<uuid>` entries fired **zero RSC and
zero document requests to `/c/<id>` per traverse step**. Eight traverse steps
were counted — back ×2 then forward ×2, across two full cycles — via
`performance.getEntriesByType("resource")` filtered to pathnames starting with
`/c/`, cross-checked against a network-request listing. The count was 0 at
every step, in both directions, in both cycles.

Supporting observations from the same run: panes restored purely client-side
(the conversation session store drives the content, not the URL); a `window`
sentinel survived every step, proving no reload and no hard navigation; and the
server emitted no per-traverse `[seeker-gate]` line.

This is **this arc's browser-matrix measurement of this configuration** — not a
general statement about Next 16 history traversal.

### The configuration the zero belongs to

State it whenever the zero is quoted. It is load-bearing:

- Every entry was created by the **patched `pushState` / `replaceState` with a
  `null` state argument** — Next's `__NA`-tagged entries
  (`app-router.js:54-56` in the same installed package). chat's write calls are
  `apps/chat/src/lib/use-conversation-url.ts:85` (`pushState(null, "", url)`),
  `:87`, and `:102` (`replaceState(null, "", …)`).
- All traversal stayed **within one document's history run**, on the
  `force-dynamic` `/` page that hosts the shallow `/c/<uuid>` entries. The
  `/c/[id]` route exists, but no traverse step in this run targeted a
  server-rendered `/c/` document.
- **Cross-document Back does re-request** — observed separately in the same
  session. That is ordinary navigation into an entry belonging to a different
  document, and it is outside this claim.
- **Traversal over shallow entries written from a `/c/[id]` HOST document was
  not part of this run.** A deep-link open renders `/c/[id]` as the host and
  the same hook then writes shallow entries from there. That run shares both
  preconditions the zero rests on (restored tree identical to the live tree;
  segments cache-warm), so the same zero is EXPECTED — but record it as
  expected-by-mechanism, not measured.

### Re-verify trigger

Re-run the measurement when any is true:

- **Any Next.js version bump.** The restore reducer and the freshness-2
  cache-node branch are version-fluid; the source half above is the exact
  code a bump can change.
- **chat ever mixes router navigations with shallow writes on the same history
  run.** The zero was measured on a run built entirely from shallow writes.
- **Any change that breaks either structural precondition** — the restored
  tree matching the live tree, or every segment keeping a cache node. The
  merge-state check below re-confirms BOTH (not only the `null` state
  argument): the write calls still go through the patched functions with a
  `null` state, and nothing new evicts segment cache nodes mid-run.

## Why This Matters

Recording only "zero" would tell a future reader that traversal is free by
design, so a Next bump that starts issuing RSC fetches would look like a
mysterious new cost with nothing to grep for. Recording only "the path exists"
would leave a per-keystroke server cost on the books that this configuration
does not actually pay, and would justify defensive work nobody needs.

Paired, the two halves are a re-check recipe: a future agent knows the exact
question to ask after a bump — _does traversal over shallow same-page entries
now spawn dynamic requests?_ — and the exact files to read to answer it.

This is the repo's standing discipline for empirical mechanism claims, applied
again: measure at the claim's own layer, then stamp date + version + method +
re-verify trigger. feat-306 learned it by reproducing what `next start` really
answers when `register()` throws. feat-328 learned it by reading the built
bundler runtime instead of reasoning about retries. Here, the plan's own review
cycle produced the discipline before the code did: an assertion, a
source-grounded contradiction, then a required measurement.

Note also where the plausible-and-correct source reading actually stopped. The
reviewer read real code that really can spawn a request — but stopped at the
CALL SITE (`restore-reducer.js:47`) rather than the DECISION POINT
(`ppr-navigations.js:826-831`), where ~200 more lines of the same installed
package settle the question deterministically. A source read that stops at a
call site yields a CAN that the next call frame may refute; trace to the
branch that decides before concluding the gap is empirical. The measurement
then serves as independent confirmation of the traced branch — not as the
only available evidence.

## When to Apply

- Any app that writes its own URLs with shallow `pushState` / `replaceState`
  under the App Router, and needs to know what Back/Forward costs.
- Any claim, in a plan or a code comment, that a framework path is or is not
  taken — before that claim is copied into a second file.
- Reviewing a framework-behavior assertion backed only by a source reading:
  first trace past the call site to the branch that decides, then measure the
  configuration that reaches it as confirmation.
- Upgrading Next.js in `apps/chat`, or in any app whose history entries it
  owns.

## Examples

The reproducible method — production build, real browser, per-step resource
count:

```text
# 0. Reach the measured state first, or every check below passes vacuously.
#    The URL hook is INERT unless the shell is gate-granted (enabled:
#    grantedShell in app-shell.tsx), so you need: SEEKER_CHAT_ENABLED on, a
#    signed-in identity whose verified email is in SEEKER_ALLOWED_EMAILS,
#    and a REACHABLE Mastra upstream — a /c/<uuid> entry appears only after
#    a turn finalizes with engine "seeker" (the serverPersisted stamp).
#    Then create AT LEAST THREE conversations that each received a completed
#    Seeker reply: the first mint REPLACES over "/", so two conversations
#    leave only two entries and the second Back exits the document into the
#    cross-document case this note excludes. Expected run: entries /c/a,
#    /c/b, /c/c; the eight steps walk c -> b -> a -> b -> c, twice.
#    Vacuity guard: if the address bar never leaves "/", the run measured
#    NOTHING — fix the setup before recording a result.
```

```bash
# 1. Production build only. `next dev`'s HMR reconnect can force a reload and
#    silently reset the state under test (feat-241 / KTD10).
pnpm --filter @forge/chat build
pnpm --filter @forge/chat start
```

```js
// 2. In the page, before traversing: plant a sentinel and zero the resource
//    buffer so each later reading is a true per-step DELTA (the buffer is
//    cumulative since page load, and it silently caps at ~250 entries).
//    Sentinel survival is the no-reload / no-hard-navigation proof. Never
//    gate on the navigation entry's "reload" type — that describes the
//    original document load.
window.__traverseSentinel = Date.now()
performance.clearResourceTimings()
```

```js
// 3. Per traverse step (back x2, forward x2, twice = 8 steps), count the
//    requests this claim is about, then clear again for the next step. Zero
//    means the restore path ran and spawned nothing: task.dynamicRequestTree
//    was null (the fully-cached branch).
performance
  .getEntriesByType("resource")
  .filter((entry) => new URL(entry.name).pathname.startsWith("/c/")).length
// => 0 at every step, both directions, both cycles (2026-08-19, next@16.2.4)
performance.clearResourceTimings()

window.__traverseSentinel // => unchanged: no reload, no hard navigation
```

Two caveats on reading the count. A NON-zero must be attributed before it is
read as a restore-path fire — a `<Link>` prefetch or router navigation to
`/c/` lands in the same buffer (chat has neither today, which is exactly the
second re-verify trigger). And the filter is scoped to `/c/`, so it cannot
see a request for a root `/` entry (one exists whenever a conversation was
created but never received a Seeker reply); the `[seeker-gate]` server check
is the required confirmation for any step that lands on `/`.

Then confirm the server side stayed quiet: no per-traverse `[seeker-gate]`
line in the `next start` output. Give that channel a positive control first:
perform one deliberate cross-document Back, confirm it DOES emit a
`[seeker-gate]` line, and only then treat the absence of the line during
shallow traversal as evidence — an unverified counterfactual on a silent log
channel is the vacuous-green shape this repo's testing discipline exists to
catch.

And to re-check the source half after a bump, on the installed package:

```bash
grep -n "startPPRNavigation\|HistoryTraversal\|spawnDynamicRequests\|completeHardNavigation" \
  apps/chat/node_modules/next/dist/client/components/router-reducer/reducers/restore-reducer.js
# And the branch that DECIDES the outcome (the call sites above only reach it):
grep -n "shouldRefreshDynamicData\|dynamicRequestTree === null" \
  apps/chat/node_modules/next/dist/client/components/router-reducer/ppr-navigations.js
```

Both halves, as they stand today:

| Half        | Says                                                                                                                                                 | Evidence                                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Source      | The restore path runs on every traverse step; it spawns a dynamic RSC request only when the restored tree mismatches or a segment lacks a cache node | `restore-reducer.js:43,47` + `ppr-navigations.js:54,71,131-165,817,826-831`, `next@16.2.4`, read 2026-08-19 |
| Measurement | It spawned 0 requests per step in chat's shallow-write configuration                                                                                 | 8 traverse steps, production build, headless Chromium, resource timing + sentinel, 2026-08-19               |

Merge state at the time of writing: the measured code is the **uncommitted
feat-209 working tree as of 2026-08-19, no PR yet**. Before trusting the
measurement against a later tree, re-confirm BOTH structural preconditions —
the write calls still pass a `null` state through the patched functions
(drift-resistant locator: `grep -n 'history.pushState\|history.replaceState'
apps/chat/src/lib/use-conversation-url.ts`; the `:85`/`:87`/`:102` offsets
above are accurate as of 2026-08-19), and nothing new evicts segment cache
nodes mid-run — the configuration, not the framework alone, is what produced
the zero.

## Related

- `docs/plans/2026-08-18-2122-feat-chat-per-conversation-urls-plan.md` — KTD1
  (line 95) holds the source half and the stop condition; KTD10 requires the
  browser proof; the browser matrix row 1 (line 307) is the measurement this
  note records.
- `docs/solutions/best-practices/per-message-boundary-limits-for-media-surfaces.md`
  — the same discipline at the bundler-runtime layer: verify per bundler, stamp
  the date and version, never reason from intuition about the other one.
- `docs/solutions/architecture-patterns/fail-closed-enforcement-point-follows-rollback-capability.md`
  — feat-306's `next start` reproduction, the repo's other verified-by-hand
  mechanism claim with no CI holding it.
- `docs/solutions/best-practices/nextjs-hmr-reload-breaks-stateful-browser-verification.md`
  — why the measurement must run under `next build` + `next start`, and why the
  `window` sentinel is the no-reload proof.
- `apps/chat/src/lib/use-conversation-url.ts` — the hook whose `null`-state
  write calls define the measured configuration.
