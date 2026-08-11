---
title: "A require()-in-try/catch root-layout guard contains module-scope throws only by import-graph luck"
date: 2026-08-07
category: best-practices
module: apps/mobile
problem_type: best_practice
component: tooling
severity: high
root_cause: scope_issue
resolution_type: documentation_update
symptoms:
  - "The same module-scope throw in `src/env.ts` surfaced as the React Native dev error overlay on one tree and as the `_layout.tsx` Startup Error panel on another, four days apart, with neither file changed"
  - "An unrelated PR that touched the root layout require block silently flipped which surface displays a startup failure"
  - "The call stack reaches `env.ts` through a static import chain from a screen module (env.ts <- config.ts <- apolloClient.ts <- useWatchHome.ts) that never passes through the guarded require"
  - "Unit tests stayed green while the prose claim was false -- they asserted the thrown message, never which surface displayed it"
  - "The claim survived three independent plan-review rounds because every reviewer reasoned inside it rather than testing it"
  - "Whether the escape can produce a silent white screen in a release bundle, where there is no dev overlay to fall back on, is still unverified"
applies_when:
  - "Relying on a hand-rolled try/catch around require() in a root layout to convert module-scope throws into a readable error screen"
  - "Adding a module-scope throw (env validation, a fail-closed refusal) to a module reachable by static import from any route or screen"
  - "Working in a framework that owns its own module graph (expo-router, Next.js App Router) where the guard lives in one module but evaluation can start in another"
  - "Reviewing a claim about WHICH surface displays an error, when every test sits at the layer of what was thrown"
related_components:
  - "apps/tv"
  - "expo-router"
  - "metro"
tags:
  - "expo-router"
  - "react-native"
  - "module-scope-throw"
  - "error-containment"
  - "startup-error"
  - "mechanism-claim"
  - "metro"
---

# A `require()`-in-try/catch guard contains a module-scope throw only by import-graph luck

## Context

`apps/mobile/app/_layout.tsx` wraps every one of its imports in a `require()` inside a `try/catch` and renders a full-screen "Startup Error" panel when that catch fires. Three prose surfaces claimed that a module-scope `throw` in `apps/mobile/src/env.ts` therefore reaches the developer as that panel.

Sometimes it does. Sometimes it does not, and the throw surfaces as the React Native dev error overlay instead. **Which one you get depends on the import graph, not on the guard** — and the graph changes with ordinary feature work.

The guard is not useless; it is _conditional_ while reading as unconditional. It contains a throw only when its guarded `require` is the **first** evaluation path into the throwing module. Once a second path exists anywhere in the route graph and happens to run first, the guard is bypassed, and nothing in the repo notices.

This document was itself wrong about that at first. Written 2026-08-07 from a single observation, it asserted flatly that the guard _does not_ catch the refusal. Re-running the identical check on 2026-08-11 — after an unrelated PR touched the root layout's require block — produced the opposite surface. The order-dependence is the finding; either flat claim is a mis-generalisation from one run.

The corollary matters more than the specific bug: the wrong claim lived only in prose and in a diagram, and every automated test for the feature sat one layer below it. The tests asserted the message a pure function returns. The claim was about which surface displays it. No test could have gone red.

Introduced by PR **#1878** (branch `feat/mobile-local-admin-endpoint`, feat-339, unmerged as of writing), which makes a development bundle of `apps/mobile` refuse to start against production admin. The refusal is a `throw` at `apps/mobile/src/env.ts:105`, decided by the pure `decideAdminEndpointAccess` in `apps/mobile/src/lib/adminEndpoint.ts`.

Putting the throw at env module scope was deliberate (KTD1 of `docs/plans/2026-08-05-004-feat-mobile-local-admin-endpoint-plan.md`): it is the earliest app-owned code and the only seam guaranteed to run before all three `getGraphQLUrl()` callers. **That choice still stands.** What was wrong was the sentence that followed it:

> `apps/mobile/app/_layout.tsx` already wraps that require in a try/catch that renders a full-screen selectable Startup Error panel showing the thrown message verbatim. R2 therefore needs no new UI.

The conclusion — no new UI needed — survives, because both surfaces show the message verbatim and selectable. What does not survive is treating the panel as a _guaranteed_ surface.

## Guidance

### What actually happens

Three mechanisms compose. All three are readable in the installed tree.

**1. In development, expo-router evaluates every route module through its own graph.** `apps/mobile/package.json` sets `"main": "expo-router/entry"`, which builds the route tree from a `require.context` over the app directory (`apps/mobile/node_modules/expo-router/_ctx.ios.js:1`), with import mode defaulting to `sync` (`apps/mobile/node_modules/expo-router/build/import-mode/index.js:3`).

Tree construction does not merely enumerate files — it evaluates them. `apps/mobile/node_modules/expo-router/build/getRoutesCore.js` loops over every context key and, **gated on `process.env.NODE_ENV === 'development'` (`:303`)**, calls `node.loadRoute()` on every non-API node to validate it has a default export. That is an ordinary synchronous require of the route module, issued from inside expo-router, before anything renders.

So `apps/mobile/app/(tabs)/index.tsx` is evaluated at startup whether or not anyone navigates to it. It statically imports `HomeScreen` -> `useWatchHome` -> `getApolloClient` -> `config.ts` -> `env.ts`. Every link is a static `import`. None of it is inside `_layout.tsx`'s `try` block.

> Do not restate this as an unqualified "expo-router loads routes eagerly." The whole-tree sweep is dev-gated, and `docs/solutions/developer-experience/deleted-worktree-under-live-metro-unresolve-error.md` correctly observes that a _non-initial_ screen's graph is fetched on navigation. Both hold. The durable claim is narrower and stronger: **route-module evaluation runs through expo-router's machinery, never inside your layout's `try`.**

**2. Metro poisons the module record, so the guard cannot win by running first.** Even where `_layout.tsx` is evaluated first and its catch does fire, the guard still cannot contain the failure. When a factory throws, `node_modules/.pnpm/metro-runtime@0.83.3/.../src/polyfills/require.js:311` sets `module.hasError = true` and stores the error; every subsequent require of that module id short-circuits at `:252-253` and re-throws the cached error without re-running the factory.

The catch therefore swallows exactly one throw — the first. The `env.ts` record stays poisoned, and the next requirer anywhere in the graph re-throws, outside the guard. "The layout caught it" and "the app shows the panel" are not the same statement. (This also explains the observed "Log 1 of 16".)

**3. The throw is `__DEV__`-gated**, so only the dev surface is in play here — `decideAdminEndpointAccess` returns allow on its first line when the dev flag is false. That bounds the practical impact of the wrong claim, and it is why the release-mode question below stays open.

### Evidence

Observed 2026-08-07, iOS simulator (iPhone 17 Pro Max, dev client, Metro on 8090), by writing a production admin URL into `apps/mobile/.env.development.local` (gitignored by design — the per-machine override slot) and cold-restarting Metro. Result: the RN dev error overlay, headed "Uncaught Error", carrying the message verbatim and selectable. Not the Startup Error panel. Stack read off the screen:

```
env.ts:105:18        <global>
config.ts:2          <global>
apolloClient.ts:15   <global>
useWatchHome.ts:4    <global>
```

Every frame is `<global>` — module-scope evaluation, not a render. The chain terminates at a hook reached only from a screen module, which is what makes _that_ bypass unambiguous.

**The opposite outcome, 2026-08-11.** Same check, same command, same simulator; the branch had since merged `origin/main`, whose #1876 added `AuthProvider` to `_layout.tsx`'s require block. This time the guard caught it: the app's own Startup Error panel rendered, with zero LogBox/uncaught indicators in the Metro log. Nothing in `env.ts`, `config.ts`, or the guard changed between the two runs — only which module reached `env.ts` first.

Two runs, two surfaces, one conclusion: **the guard's coverage is a property of the import graph at that moment.** Treat a single observation of either surface as a fact about that tree, not about the pattern.

### What we did not verify

**On the 2026-08-07 run, whether the Startup Error panel also rendered behind the overlay.** Attempts to dismiss or minimise the dev overlay via `idb ui tap` did not land, so what sat underneath was never seen. That specific question stays open; it does not affect the order-dependence conclusion, which rests on the 2026-08-11 run rendering the panel with no overlay at all.

**What decides the order.** Both outcomes are recorded; the precise rule that picks a winner between expo-router's route-module evaluation and the root layout's guarded require is not established here. Do not infer one from the two data points.

**Whether the same reasoning defeats the guard in a release bundle.** This is the consequential open question and it is a hypothesis, not a finding. It could not be tested through this feature, because the refusal is `__DEV__`-gated.

Why it is worth testing: the guard exists (per the 2026-04-10 doc below) to convert a _silent white screen_ into a visible error — a release-mode failure mode. But the paths differ: the whole-tree `loadRoute()` sweep is dev-gated, so a release bundle does not evaluate every route up front. The initial route is still loaded outside the guard, and Metro's poisoned-record semantics are **not** dev-gated. Enough to suspect, not enough to assert.

To settle it: pick a module `_layout.tsx` requires that is _also_ statically imported from a screen, make it throw unconditionally, and run a release configuration (`npx expo start --no-dev --minify`, or `expo export` plus a preview install). Observe whether the panel appears or the screen goes white.

### `apps/tv` carries the same guard, unaudited

`apps/tv/app/_layout.tsx` runs the identical pattern — `moduleError` at `:26`, the same `require()` block, the same panel at `:226`-`:254` — and carries the same unqualified comment at `:36`: "require() is intentional — static imports cause silent white screens when module-level throws (e.g., env validation) crash the entire module graph."

`apps/tv` has **not** been re-verified against this finding, and unlike mobile its `CLAUDE.md` carries no prose about the guard at all. Anyone extending the correction should start there.

## Why This Matters

### The guard's coverage drifts on ordinary feature work

The guard was written 2026-04-10 against that day's import graph. `apps/mobile/src/hooks/useWatchHome.ts` was added 2026-06-11 — two months later — and with it a second static path from a screen module into `env.ts`. On 2026-08-11 a third change, #1876's `AuthProvider`, moved the balance back the other way. None of the three touched `_layout.tsx`'s catch or `env.ts`'s throw; none was flagged, because nothing encodes "`apps/mobile/src/env.ts` must only be reachable through the guarded require."

That is the general shape: **a `try/catch` around one require is a claim about the whole module graph, enforced at exactly one point in it.** Ordinary feature work moves the claim's truth value in either direction without touching the file that makes it — which is worse than a guard that fails consistently, because a passing manual check proves only that day's graph.

Second-order, and the reason this is more than cosmetic: `apps/mobile/app/_layout.tsx` reports the caught module-init failure to Datadog, gated on `moduleError` being set. On a tree where the throw bypasses the guard, it also bypasses the only telemetry meant to observe boot failures — so boot-failure observability silently depends on import order too.

### How the claim survived three review rounds

Reconstructed from the planning session (2026-07-28 -> 2026-08-06) (session history):

- **The evidence asymmetry was visible in the sentence that introduced it.** The KTD's first half is measured — three `getGraphQLUrl()` callers enumerated, two classified as throw-swallowing. Its second half ("Startup already renders a full-screen error panel") is a bare existence claim with no counterpart analysis of _what reaches_ that panel. The investigative effort went into the alternative being **rejected**, not the mechanism being **adopted**.
- **The adversarial budget was spent on the rejected option.** Two verifiers were dispatched to check whether a refusal inside `getGraphQLUrl()` would break existing tests. The design that was chosen got none.
- **Reviewers reasoned inside the assumption.** The strongest adversarial finding of the whole arc objected that a LAN address would show the _wrong message_ — an objection that presupposes a message is shown at all.
- **The confidence gate mistook provenance for proof.** It recorded that "every KTD carries file-level evidence" — meaning a file path was cited and the panel exists at a known line. It did not mean the panel's _coverage set_ had been enumerated.
- **Adjacent module-graph reasoning happened, for the wrong property.** The units were revised because "the import cycle needs a leaf module." The planner did reason about `env.ts`'s import graph — but asked "will this cycle?", never "who imports `env.ts`, and does expo-router evaluate any of them outside the guard?" Reachability is one step from cyclicity, and the step was not taken.
- The same session repeatedly self-corrected by empirical probe — on `recordWatchSearchEvent`, on `eas-cli` source, on the `localhost` middleware warning, on `__DEV__` dead-code elimination in a real export. The panel claim is the one load-bearing assertion that never got such a probe.

`expo-router`'s route-module evaluation is never named anywhere in the record. This was not a rejected consideration; it was outside the frame.

## When to Apply

Whenever a guard's guarantee depends on a module-graph property rather than on the guard's own code — and whenever a claim is about _which surface_ something appears on.

### Testing a claim like this at its own layer

The feature's unit tests are good tests. `adminEndpoint.test.ts` covers `decideAdminEndpointAccess` thoroughly and asserts the refusal message contains the host and the override name. None of it can contradict "the Startup Error panel displays it," because none of it involves a surface. **Deleting the entire panel from `apps/mobile/app/_layout.tsx` would leave the suite green.**

Three ways to close the gap, cheapest first.

**1. Encode the invariant, not the outcome.** The guard's real precondition is a module-graph property: `apps/mobile/src/env.ts` must not be reachable from any route module except through the guarded require. That is statically testable — walk the static import graph from `apps/mobile/app/**` and fail if `env.ts` appears on a path not originating in the guarded block. Such a test would have gone red on 2026-06-11, months before anyone triggered a throw. This is the guard worth building, because it fails when the claim stops being true rather than when someone happens to trigger it.

**2. Assert at the claim's own layer.** The claim is "surface X shows message Y," so the test must produce a surface. `apps/mobile/node_modules/expo-router/build/testing-library` forces sync import mode, which suggests a `renderRouter` test with a module mocked to throw at import could assert which surface appears. A candidate, not a recipe — untried here, and a jest environment is not a device.

**3. If neither is available, stamp the claim.** Where a prose claim rests on a hand-run observation, say so in place with the date, platform, versions, and command. A claim carrying no provenance reads as derived from the code, and every future reader either re-derives it or believes it.

### What a reliable guard would look like

If the panel must be reliable, `try/catch`-around-`require` is the wrong tool — it can only be as reliable as the module graph is narrow.

- **Don't throw at module scope.** Have `env.ts` export a decision value and let exactly one seam turn it into a rendered panel. Any number of importers can read a decision without exploding. The only option that makes the guarantee structural rather than graph-dependent.
- **Install a global handler before the router loads.** `ErrorUtils.setGlobalHandler` from the entry file, ahead of `expo-router/entry`, sees uncaught module-scope throws regardless of which module produced them. Not implemented or tested here.
- **Accept the surface you get, and write it down.** What PR #1878 does, and the right trade here: the dev overlay shows the message verbatim and selectable, satisfying the requirement; the refusal is `__DEV__`-gated so no shipped bundle is affected. This costs exactly one thing — the documentation must not claim a surface it does not deliver.

## Examples

### Correcting a propagated claim without over-sweeping

The three affected surfaces were treated differently on purpose.

**The plan got additive dated corrections, not a rewrite.** A plan is a decision record; rewriting its reasoning destroys the record of what was decided and why. Two dated blocks were added — under KTD1 and under the boot-sequence diagram — each naming what is wrong (the mechanism), what still holds (the enforcement point, and the requirement), and what was not determined.

**The live instruction surfaces were corrected outright.** `apps/mobile/CLAUDE.md` and the roadmap ticket are read as current instructions, not history, so a superseded claim with a note beside it would keep misleading. CLAUDE.md now leads with "Do not assume it renders the Startup Error panel," gives the observed stack, and dates the observation.

**Two unrelated mentions were softened, not restated.** Both describe a _different_ path — a zod validation throw from a dashboard-typed URL in a _release_ bundle. No release-mode evidence was gathered, so asserting anything new there would repeat the exact error being corrected: generalizing a dev observation into a release claim. They went from "shows a Startup Error panel" to "hard-fails startup" — true either way, claiming nothing about the surface.

That last move is the transferable one. When a correction lands, the temptation is to sweep every occurrence of the phrase and rewrite them consistently. **Occurrences describing a different mechanism are not covered by your evidence**, and rewriting them propagates the same unfounded confidence in the opposite direction. Soften to what you can defend; leave the rest for whoever gathers the evidence.

### Residual, known and unfixed

- `docs/plans/2026-08-05-004-feat-mobile-local-admin-endpoint-plan.md` — a U-step approach line still reads "The thrown message surfaces through the existing Startup Error panel (KTD1)". It inherits the correction by pointer, since KTD1 now carries it, but a reader landing on the step and not the decision sees only the old claim.
- `apps/tv` — the whole guard, per the section above.

## Relationship to `metro-env-inlining-eas-update-white-screen-20260410.md`

This **qualifies** that doc; it does not overturn it.

That document diagnosed a real and separate bug — Metro failing to inline `process.env.EXPO_PUBLIC_*` nested inside `createEnv()` arguments — and its primary fix (the module-scope `_inlined` block) is still in `apps/mobile/src/env.ts`, still correct, still load-bearing. Its section 2 introduced the `require()`-in-`try/catch` pattern, and its Prevention item 2 generalized it:

> Use `require()` with try/catch in root layout files for Expo apps distributed via EAS Update. This prevents silent white screens from module-level throws.

The qualification is on scope, in two parts:

- **It prevents silent white screens from throws it actually catches** — and it catches a throw only when the guarded require is the sole evaluation path into the throwing module. In an expo-router app that is a property of the current import graph, not of the pattern. Whether the guard holds must be re-asked every time the graph grows, which is why it needs a test rather than a convention.
- **The dev-mode half is now measured; the release-mode half is not.** In development the guard is demonstrably bypassed for `env.ts` (this doc). In release — the mode that doc was written about — nothing has been measured, and the paths differ enough (the `loadRoute()` sweep is dev-gated) that the dev result does not transfer. Its advice stands as written until someone runs the release experiment above.

## Related

- `docs/solutions/runtime-errors/metro-env-inlining-eas-update-white-screen-20260410.md` — the doc this qualifies; source of the pattern and of the `_inlined` block still in `env.ts`
- `docs/solutions/runtime-errors/expo-router-standalone-no-scheme-launch-crash-20260623.md` — sibling, the **above** case of the same bypass family: a JS throw above your own root component bypasses every guard inside it (expo-router's `ContextNavigator` is the parent of `apps/mobile/app/_layout.tsx`). This doc is the **beside** case — a throw reached through expo-router's route-module graph, a sibling of the guarded require. Together they are the complete taxonomy of what the layout guard cannot see; a reader who knows only one case will mis-predict the other
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — the META home for this shape. Its feat-306 row is the closest sibling: an empirical mechanism claim carried in prose whose every test sat at a different layer. This instance adds a variant — the wrong claim was also a **mermaid diagram lane**, which reads as architecture fact and is further still from anything executable
- `docs/solutions/best-practices/per-message-boundary-limits-for-media-surfaces.md` — nearest structural twin: a containment guard whose real coverage is narrower than its claim, after the claim had been copied into a comment, a CLAUDE.md, and a plan
- `docs/solutions/developer-experience/deleted-worktree-under-live-metro-unresolve-error.md` — reconciles rather than contradicts; see the note under mechanism 1
- `docs/solutions/developer-experience/verifying-mobile-expo-worktree-changes-in-simulator-20260608.md` — the repo's recipe for the only thing that falsified this: launching the app and reading which surface appears
- `apps/mobile/CLAUDE.md` § Admin endpoint resolution (feat-339) — the corrected live instruction
