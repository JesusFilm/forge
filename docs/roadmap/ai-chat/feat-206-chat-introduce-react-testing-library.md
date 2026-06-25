---
id: "feat-206"
title: "Introduce React Testing Library to the chat app"
owner: "jian wei"
priority: "P2"
status: "not-started"
start_date: "2026-07-03"
duration: 2
depends_on:
  - "feat-201"
blocks: []
tags:
  - "web"
---

## Problem

`apps/chat` tests use the monorepo's plain `react-dom/client` + `act` +
`// @vitest-environment jsdom` convention with **no** Testing Library (inherited
from the `apps/admin` style). For this app that convention has become a tax, and
chat is **intentionally separate** from `apps/admin`/`apps/web`, so it can adopt
RTL without forcing a monorepo-wide change:

- The suite is **interaction-heavy** and most of `app-shell.test.tsx` (~586
  lines) is hand-rolled DOM plumbing that exists only because there is no
  `user-event`: typing via the `HTMLTextAreaElement.prototype` value-setter,
  raw `dispatchEvent(new KeyboardEvent(...))` for Enter/Escape, manual
  `submit` events, and bespoke `buttonByLabel`/`clickButton`/`getTextarea`
  query helpers re-implemented per file.
- Hooks need a **workaround**: `use-sidebar-chrome.test.ts` publishes the hook's
  return through a `useEffect` into a module-level `latest` because there is no
  `renderHook`.
- The app is about to become **async**: feat-205 wires the Seeker Mastra route,
  replacing the synchronous stub with a rejectable, possibly-hanging call plus
  error/timeout/loading states. `findBy`/`waitFor` + `user-event` are far
  cleaner there than the current `vi.useFakeTimers()` + manual `act` juggling.

RTL does **not** fix the one jsdom gap we hit (focus-restore-on-close depends on
`offsetParent`, which jsdom can't represent) — that stays a browser check.

Ideally land this **before** feat-205's async wiring (so those tests are written
in RTL from the start) and **after** feat-203's sidebar test churn settles (so
the suite is migrated once). Neither is a hard blocker.

## Entry Points — Read These First

1. `apps/chat/vitest.config.ts` — `environment: "node"` with per-file jsdom opt-in; no `setupFiles`. The place to flip the default env and wire a setup file.
2. `apps/chat/package.json` — devDeps currently `vitest`, `jsdom`, no `@testing-library/*`. Add the RTL deps here.
3. `apps/chat/src/components/shell/app-shell.test.tsx` — the 586-line behavioral suite carrying the bulk of the hand-rolled plumbing; the biggest migration win.
4. `apps/chat/src/components/shell/use-sidebar-chrome.test.ts` — the hook test whose `useEffect`-capture harness `renderHook` replaces outright.
5. `apps/chat/src/components/shell/sidebar-*.test.tsx` and `src/lib/*.test.ts` — the remaining colocated tests to migrate (or leave: `conversations.test.ts` / `chat-stub.test.ts` are pure-function and need no RTL).
6. `apps/chat/CLAUDE.md` → "Key Conventions" — currently mandates the no-testing-library style; update it to record the deliberate divergence and the browser-verify caveat.

## Grep These

- `IS_REACT_ACT_ENVIRONMENT` — per-file flag the RTL migration removes.
- `Object.getOwnPropertyDescriptor(HTMLTextAreaElement` — the value-setter typing hack `user.type` replaces.
- `dispatchEvent(new KeyboardEvent` / `new Event("submit"` — raw events `user.keyboard`/`user.click` replace.
- `createRoot(` / `import { act }` — boilerplate RTL `render` + auto-cleanup subsumes.
- `// @vitest-environment jsdom` — per-file directives droppable once the config default is jsdom.

## What To Build

1. **Add dev deps** pinned for React 19: `@testing-library/react` (v16+), `@testing-library/user-event`, `@testing-library/jest-dom`.
2. **Add `apps/chat/vitest.setup.ts`**: `import "@testing-library/jest-dom/vitest"` and an `afterEach(cleanup)`; wire it via `setupFiles` in `vitest.config.ts` and set `test.environment: "jsdom"` as the app default (drop per-file directives).
3. **Migrate the suite** (small — ~1,160 lines across 8 files): replace the hand-rolled helpers with `screen` role/label queries + `user-event`; move `use-sidebar-chrome.test.ts` to `renderHook` (`result.current` + `rerender`); leave pure-function tests as plain vitest.
4. **Update `apps/chat/CLAUDE.md`**: document that chat deliberately diverges from the `apps/admin`/`apps/web` no-testing-library convention, and keep the note that focus-visibility/layout behavior (e.g. focus-restore-on-close) is browser-verified because jsdom has no layout.
5. **Confirm the retired convention doc is gone**: the `docs/solutions/best-practices/unit-testing-react-hooks-plain-react-dom-act-*.md` learning existed only to work around the missing `renderHook`; it should not be reintroduced.

## Constraints

- **`apps/chat` only.** Do not touch `apps/admin`/`apps/web` tests or add RTL to the root — this divergence is scoped to chat by design.
- **No behavior-coverage regression.** Every existing assertion must survive the migration; this is a test-mechanism swap, not a coverage change.
- **Separate PR from feat-203.** Do not fold the framework swap into the sidebar refactor — it muddies that PR's "no behavior change, tests stay green" story.
- **RTL does not replace browser checks.** jsdom still can't represent layout/visibility; keep the browser-verified items as such.
- Avoid a long-lived mixed-style state — migrate the whole (small) suite in one pass rather than leaving half on each convention.

## Verification

- `pnpm --filter @forge/chat test` — all tests pass; count of assertions not reduced.
- `pnpm --filter @forge/chat lint` and `... typecheck` — clean.
- Grep is clean of the retired plumbing: no `IS_REACT_ACT_ENVIRONMENT`, no `HTMLTextAreaElement.prototype` value-setter, no raw `KeyboardEvent`/`submit` dispatch, no bare `createRoot`/`act` harness in the migrated component tests.
- `use-sidebar-chrome.test.ts` uses `renderHook` (no module-level `latest` / `useEffect`-capture harness).
- `apps/chat/CLAUDE.md` reflects the new convention and the browser-verify caveat.
