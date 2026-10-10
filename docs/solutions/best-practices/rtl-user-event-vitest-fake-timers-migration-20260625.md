---
title: "Migrating a Vitest suite to React Testing Library + user-event (fake-timer hang, realism-revealed assertions, jest-dom types)"
date: 2026-06-25
category: best-practices
module: apps/chat
problem_type: best_practice
component: testing_framework
severity: medium
applies_when:
  - "Adopting @testing-library/react + @testing-library/user-event in a Vitest project that uses vi.useFakeTimers()"
  - "Migrating tests off plain react-dom/client + act onto RTL"
  - "jest-dom matchers (toBeDisabled, toHaveValue, toBeInTheDocument) fail to typecheck under tsc --noEmit"
tags:
  - react-testing-library
  - user-event
  - vitest
  - fake-timers
  - jsdom
  - jest-dom
  - testing
---

# Migrating a Vitest suite to React Testing Library + user-event

Three non-obvious traps surfaced migrating `apps/chat`'s test suite from the
monorepo's plain `react-dom/client` + `act` convention onto React Testing
Library + `user-event` + `renderHook` (forge#1372, roadmap feat-206). Each cost
a debug cycle; all three are mechanical once known.

> Scope note: this is a **chat-only** convention. `apps/admin` and `apps/web`
> deliberately stay on plain `react-dom/client` + `act` (no testing-library).
> See `apps/chat/CLAUDE.md` "Key Conventions".

## Context

The suite was interaction-heavy (typing, Enter/Escape, clicks, a reply that
lands via `setTimeout`) and had been written with hand-rolled DOM plumbing
because there was no `user-event`: a `HTMLTextAreaElement.prototype` value-setter
to type, raw `dispatchEvent(new KeyboardEvent(...))`, and a `useEffect`-into-a-
module-level-`latest` harness to read a hook's return. RTL removes all of that —
but the migration is not a pure find-and-replace. The three traps below are what
review and the test run actually caught.

## Guidance

### 1. user-event + Vitest fake timers: the documented config HANGS — use `shouldAdvanceTime: true`

When a test installs `vi.useFakeTimers()` (here: because the stub reply fires
through `setTimeout`), every `await user.click(...)` / `user.type(...)` **hangs
to the 5s test timeout**. The widely-documented fix —

```ts
// HANGS under Vitest 3: user-event's awaited interactions never resolve
vi.useFakeTimers()
const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
```

— was **not** sufficient in this project (Vitest 3.2 / user-event 14.6). Adding
`delay: null` did not help either. The config that works:

```ts
beforeEach(() => {
  // shouldAdvanceTime lets user-event's awaited interactions resolve; the
  // reply setTimeout is still advanced deterministically by an explicit
  // act(() => vi.advanceTimersByTime(DELAY)).
  vi.useFakeTimers({ shouldAdvanceTime: true })
  user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
})
```

`shouldAdvanceTime` makes the fake clock auto-advance with real wall-time, so
user-event's internal awaits settle, while you still control the domain timer
(an 800ms reply here) by jumping it explicitly. The auto-advance does **not**
fire the domain timer early — tests don't spend the domain delay (800ms) inside
an `await`, so the explicit jump remains the only thing that fires it. Caveat
when porting this elsewhere: that guarantee holds only while awaited
interactions stay short. If a test awaits a genuinely slow interaction (a very
long `user.type`, a real delay) for more wall-time than the domain delay between
the action and the explicit jump, auto-advance can cross the boundary and fire
the timer early — keep awaited interactions short or jump the timer right after
the action. Diagnosis tell: nearly all interaction tests time out at exactly
5000ms while the no-interaction tests pass.

### 2. user-event is more faithful than synthetic dispatch — it reveals assertions that only passed before because the old events under-simulated reality

Synthetic `dispatchEvent` / prototype value-setters skip browser behaviors that
`user-event` reproduces. A mechanism migration is therefore **not always
assertion-preserving by accident** — two assertions legitimately changed, each
strengthening the test:

- **Shift+Enter inserts a real newline.** The old raw `KeyboardEvent` could not
  insert text, so the test asserted the draft was unchanged (`"no send"`).
  `user.keyboard("{Shift>}{Enter}{/Shift}")` performs the real default action,
  so the retained draft is now `"no send\n"`. Assert the newline — it proves
  more than the original did.

- **user-event refuses to act on disabled elements.** The old tests bypassed
  `disabled` by forcing the value through the prototype setter and dispatching
  `submit` directly. `user.type` / `user.click` correctly no-op on a disabled
  control. So a test that sends, triggers an error, and then expects the
  composer to accept a fresh send must first **flush the React state update that
  re-enables it**. When an error escapes a `setTimeout` callback, React may not
  have committed the slot-release re-render before the throw propagated:

  ```ts
  expect(() => act(() => vi.advanceTimersByTime(DELAY))).toThrow("boom")
  act(() => {}) // flush the deferred slot-release render
  expect(getTextarea()).toBeEnabled() // make the recovery observable
  await sendMessage("after throw") // now user-event will actually type
  ```

Corollary for queries: prefer role/name (`getByRole("button", { name: "Send" })`).
Where two controls share an accessible name (here a "New conversation" _action_
and a default-titled conversation _row_), disambiguate by container scope
(`within(nav)` / `!nav.contains(el)`), not by DOM order. Keep `querySelector`
only for elements whose role legitimately changes — e.g. an `<aside>` that is
`role="dialog"` when open and a complementary rail otherwise; `getByRole`
against it breaks across states.

### 3. jest-dom matcher types need a `src`-included reference when the setup file lives outside tsconfig `include`

`vitest.setup.ts` at the app root imports `@testing-library/jest-dom/vitest`
(which augments Vitest's `Assertion` interface at runtime). But if tsconfig's
`include` is `src/**/*` and the setup file lives at the app root, **tsc never
sees the augmentation** — `toBeDisabled`, `toHaveValue`, `toBeInTheDocument`,
etc. fail `tsc --noEmit` with `Property '...' does not exist on type
'Assertion<HTMLElement>'`, even though the tests run green.

Fix: add a one-line declaration file _inside_ the `include` glob:

```ts
// apps/chat/src/vitest.d.ts
import "@testing-library/jest-dom/vitest"
```

Do **not** reach for `compilerOptions.types: ["@testing-library/jest-dom"]` —
that narrows the global types array and can drop other auto-included `@types`.

Also pin `@testing-library/dom` explicitly: RTL v16 lists it as a **peer**, not
a bundled dependency.

## Why This Matters

A test-mechanism migration is sold as "no behavior change, tests stay green," so
the failure modes are easy to mis-read: the fake-timer hang looks like a broken
test rather than a config gap; the realism-revealed assertion changes look like
regressions rather than strengthenings; and the jest-dom type errors look like a
missing dependency rather than a tsconfig-scope gap. Knowing all three up front
turns a multi-cycle debug into mechanical edits, and keeps the "every assertion
survives" guarantee honest (you can explain exactly why the two that changed are
stronger, not weaker).

## When to Apply

- Installing RTL + user-event in any Vitest project that already uses
  `vi.useFakeTimers()` for domain timers.
- Migrating an existing `react-dom/client` + `act` suite to RTL — budget for
  per-assertion review, not a blind sweep.
- Seeing jest-dom matchers fail typecheck while passing at runtime.

## Examples

Hook tests migrate to `renderHook` cleanly, but an effect that focuses a
`ref`-bound node needs a real DOM target (renderHook renders no DOM of its own):

```ts
const { result, rerender } = renderHook((p) => useSidebarChrome(p), {
  initialProps: { ...base, mobileOpen: false },
})
const btn = document.createElement("button")
document.body.appendChild(btn)
result.current.closeRef.current = btn // give the focus effect a target
rerender({ ...base, mobileOpen: true })
expect(document.activeElement).toBe(btn)
```

This replaces the old "publish the hook's return through a `useEffect` into a
module-level `latest`" harness entirely.

## Related

- Plan: `docs/plans/2026-06-25-001-feat-chat-react-testing-library-plan.md`
- Convention: `apps/chat/CLAUDE.md` "Key Conventions" (the deliberate chat-only
  RTL divergence + the browser-verify caveat for focus-restore-on-close, which
  depends on `offsetParent` and so cannot be asserted in jsdom)
- PR: forge#1372 (roadmap feat-206)
