---
title: "feat: Introduce React Testing Library to apps/chat"
date: 2026-06-25
type: feat
status: ready
origin: docs/roadmap/ai-chat/feat-206-chat-introduce-react-testing-library.md
plan_depth: standard
---

# feat: Introduce React Testing Library to apps/chat

## Summary

Adopt React Testing Library (RTL) + `user-event` + `jest-dom` in `apps/chat`
**only**, and migrate its five DOM-touching test files off the hand-rolled
`react-dom/client` + `act` plumbing the monorepo inherited from `apps/admin`.
This is a **test-mechanism swap, not a coverage change**: every existing
assertion survives, the suite stays green, and no production code under
`apps/chat/src/components` or `apps/chat/src/lib` changes. `apps/admin` and
`apps/web` keep their plain-`react-dom` convention untouched — this divergence
is scoped to chat by design (origin ticket Constraints).

The suite today is 8 test files / 63 tests. Five are DOM tests that migrate;
three are pure-function tests (`lib/conversations.test.ts`,
`lib/chat-stub.test.ts`, `components/shell/sidebar-collapsed-styles.test.ts`)
that stay plain vitest and are **not** touched beyond inheriting the new default
jsdom env.

---

## Problem Frame

`apps/chat` tests carry mechanism cost that RTL removes (origin Problem):

- `app-shell.test.tsx` (~586 lines) is mostly hand-rolled DOM plumbing that
  exists only because there is no `user-event`: typing via the
  `HTMLTextAreaElement.prototype` value-setter, raw
  `dispatchEvent(new KeyboardEvent(...))` for Enter/Escape, manual `submit`
  events, and bespoke `buttonByLabel` / `clickButton` / `getTextarea` query
  helpers re-implemented per file.
- `use-sidebar-chrome.test.ts` needs a workaround: it publishes the hook's
  return through a `useEffect` into a module-level `latest` because there is no
  `renderHook`.
- The app is about to become async (feat-205 wires the Seeker Mastra route).
  `findBy` / `waitFor` + `user-event` are far cleaner for the rejectable,
  possibly-hanging call than the current `vi.useFakeTimers()` + manual `act`
  juggling. Landing RTL **before** that async wiring means those tests are
  written in RTL from the start.

RTL does **not** fix the one jsdom gap the suite hits: focus-restore-on-close
depends on `offsetParent`, which jsdom can't represent. That stays a
browser-verified check, and the CLAUDE.md note recording it must survive.

---

## Requirements

Traced from the origin ticket's "What To Build" and "Verification":

- **R1** — Add RTL dev deps pinned for React 19: `@testing-library/react` (v16+),
  `@testing-library/user-event`, `@testing-library/jest-dom`, and the explicit
  `@testing-library/dom` peer (RTL v16 does not bundle it).
- **R2** — Add `apps/chat/vitest.setup.ts` (`import "@testing-library/jest-dom/vitest"`
  - `afterEach(cleanup)`); wire it via `setupFiles` and flip
    `test.environment` to `jsdom` as the app default; drop per-file
    `// @vitest-environment jsdom` directives.
- **R3** — Migrate the five DOM test files to `screen` role/label queries +
  `user-event`; move `use-sidebar-chrome.test.ts` to `renderHook`
  (`result.current` + `rerender`); leave the three pure-function tests as plain
  vitest.
- **R4** — Update `apps/chat/CLAUDE.md`: record the deliberate divergence from
  the `apps/admin`/`apps/web` no-testing-library convention and keep the
  browser-verify caveat for focus-restore/layout behavior.
- **R5** — No behavior-coverage regression: every existing assertion survives;
  assertion count is not reduced. The grep-clean and "tests pass" checks in
  Verification all pass.
- **R6** (origin "Confirm"): the retired
  `docs/solutions/best-practices/unit-testing-react-hooks-plain-react-dom-act-*.md`
  learning is **not** reintroduced. _(Already absent on `main` — verified during
  planning. This is a guard, not work.)_

---

## Key Technical Decisions

### KTD1 — `user-event` must be configured for fake timers

`app-shell.test.tsx` relies on `vi.useFakeTimers()` because the stub reply fires
through `setTimeout(STUB_REPLY_DELAY_MS)` in `use-conversations.ts` (timing lives
in the hook, not the stub — see chat CLAUDE.md "stub seam"). `user-event` v14
defaults to _real_ timers for its inter-event delay; under fake timers an
un-configured `await user.click(...)` **hangs**. Every file that calls
`vi.useFakeTimers()` must create its user instance with:

```ts
// directional — exact call site is the implementer's
const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
```

Files with no timers (`sidebar-header`, `sidebar-new-conversation`,
`sidebar-conversation-list`) use a plain `userEvent.setup()`.

### KTD2 — Keep `act(() => vi.advanceTimersByTime(...))` for the reply delay; use RTL's `act`

The stub reply is a `setTimeout`, not an awaitable promise, so `findBy`/`waitFor`
cannot drive it forward under fake timers. The reply-advance helper stays an
explicit timer advance, but imported from `@testing-library/react`
(`act`) rather than `react`. This is **not** the retired harness — the grep
target the ticket retires is the `createRoot` + `act`-render _setup harness_ in
`beforeEach`, not RTL's `act` used to flush a timer tick. Code review should read
the Verification grep accordingly (KTD acknowledged so it isn't mis-flagged).

### KTD3 — The double-submit test keeps a synchronous `fireEvent`, not `user.click`

The "ignores a rapid double-submit before re-render" assertion depends on two
submits landing **within the same render cycle** (the double-send guard's
window). `await user.click()` flushes React between clicks, dissolving the
condition under test. Use RTL's `fireEvent.submit(form)` twice synchronously for
this one case. `fireEvent` is first-class RTL — it is **not** the retired
`form.dispatchEvent(new Event("submit"))` plumbing, and does not match the
Verification grep patterns. Preserve the assertion: a rapid double-submit yields
2 messages, not 4.

### KTD4 — `renderHook` covers the state machine; the focus test needs a real DOM target

Five of the seven `use-sidebar-chrome` tests are pure state-machine assertions
(clip lifecycle, width-vs-opacity `transitionEnd`, 400ms fallback, Escape-only-
while-open, listener cleanup) and convert cleanly to `renderHook` →
`result.current` + `rerender(newProps)`. Two tests need a DOM node bound to the
hook's `closeRef` (the focus-trap effect calls `.focus()` on `closeRef.current`):

- **Primary approach:** stay in `renderHook` — create a `<button>`, append it to
  `document.body`, assign it to `result.current.closeRef.current`, then
  `rerender({ ...base, mobileOpen: true })` so the effect focuses it. Assert
  `document.activeElement`.
- **Acceptable fallback:** render a 3-line local component with RTL `render` that
  calls the hook and attaches `chrome.closeRef` to a labeled button, then assert
  on `screen.getByLabelText("Close sidebar")`.

Either way the **module-level `latest` + `useEffect`-capture harness is deleted**
— that is the origin's hard requirement for this file. Implementer picks the
cleaner of the two at `ce-work` time.

### KTD5 — `jsdom` becomes the app-wide default env; pure tests inherit it harmlessly

Flipping `test.environment` to `jsdom` applies it to all eight files, including
the three pure-function ones. jsdom is a superset of the node env for those
(they touch no DOM), so they keep passing; the per-file directives are dropped
everywhere. This matches the origin's "set `test.environment: jsdom` as the app
default" instruction.

### KTD6 — Version pinning

No `@testing-library/*` exists anywhere in the monorepo and there is no pnpm
catalog entry, so chat pins its own caret ranges in `apps/chat/package.json`
(current published, React-19-compatible): `@testing-library/react ^16.3.x`,
`@testing-library/dom ^10.4.x`, `@testing-library/user-event ^14.6.x`,
`@testing-library/jest-dom ^6.9.x`. Exact patch resolved by `pnpm add` at
implementation time; the lockfile is committed.

---

## Implementation Units

### U1. Add RTL dev dependencies to apps/chat

**Goal:** `apps/chat` can import `@testing-library/react`, `/user-event`,
`/jest-dom`, and the `@testing-library/dom` peer.

**Requirements:** R1.

**Dependencies:** none.

**Files:**

- `apps/chat/package.json` (add four `devDependencies`)
- `pnpm-lock.yaml` (regenerated)

**Approach:** Add the four packages as devDeps via `pnpm add -D --filter @forge/chat`
so the lockfile updates correctly. Include `@testing-library/dom` explicitly —
RTL v16 lists it as a _peer_, not a bundled, dependency. Confirm versions match
KTD6 ranges. No root-level or other-app manifest changes (origin Constraint:
"do not add RTL to the root").

**Patterns to follow:** existing `devDependencies` block in `apps/chat/package.json`
(caret ranges, alphabetical-ish grouping).

**Test scenarios:** Test expectation: none — dependency manifest change.
Verified transitively by U2–U5 importing the packages and the suite running.

**Verification:** `pnpm --filter @forge/chat install` resolves; the four
packages appear under `devDependencies`; no change to `dependencies` or to any
other package's manifest.

---

### U2. Add the vitest setup file and flip the default env to jsdom

**Goal:** jest-dom matchers are globally available, RTL auto-cleans between
tests, and jsdom is the app default so per-file env directives become redundant.

**Requirements:** R2.

**Dependencies:** U1.

**Files:**

- `apps/chat/vitest.setup.ts` (new)
- `apps/chat/vitest.config.ts` (modify)

**Approach:**

- `vitest.setup.ts`: `import "@testing-library/jest-dom/vitest"` and register
  `afterEach(() => cleanup())` (import `cleanup` from `@testing-library/react`,
  `afterEach` from `vitest`). Explicit cleanup per origin instruction — do not
  rely on implicit auto-cleanup detection.
- `vitest.config.ts`: set `test.environment: "jsdom"`, add
  `test.setupFiles: ["./vitest.setup.ts"]`, keep the existing `include` globs
  and the `@` alias. Replace the "DOM tests opt in per-file" comment with one
  noting jsdom is now the app default (3-line cap, per chat CLAUDE.md).

**Patterns to follow:** existing `defineConfig` shape in
`apps/chat/vitest.config.ts`; the comment-style cap in `apps/chat/CLAUDE.md`.

**Test scenarios:** Test expectation: none — test-harness config. Proven by the
migrated suites (U3–U5) running green under the new default without per-file
directives.

**Verification:** with directives still present (transitional), `pnpm --filter
@forge/chat test` stays green; jest-dom matchers (e.g. `toBeDisabled`) resolve
type-wise under `tsc --noEmit`.

---

### U3. Migrate app-shell.test.tsx to RTL + user-event

**Goal:** the 586-line behavioral suite uses `render` / `screen` /
`user-event`, with the hand-rolled harness and helpers gone — every one of its
30 assertions preserved.

**Requirements:** R3, R5.

**Dependencies:** U2.

**Files:**

- `apps/chat/src/components/shell/app-shell.test.tsx` (rewrite)

**Approach:** Replace the `beforeEach` `createRoot`/`act` harness with RTL
`render(<AppShell />)`. Keep `vi.useFakeTimers()` in `beforeEach` /
`vi.useRealTimers()` in `afterEach` (RTL `cleanup` handles unmount via U2's
setup). Replace helpers:

- `getTextarea` → `screen.getByRole("textbox", { name: "Message" })` (or
  `getByLabelText("Message")`).
- `getSendButton` → `screen.getByRole("button", { name: /send/i })` /
  `screen.getByRole("button", { name: ... })` matching the submit control; if it
  has no accessible name, query by `getByRole("button")` scoped to the form.
  Resolve the exact accessible name by reading `chat/composer.tsx` at impl time.
- `getLog` → `screen.getByRole("log", { name: "Conversation" })`.
- `getConversationNav` → `screen.getByRole("navigation", { name: "Conversations" })`.
- `typeDraft` / `pressEnter` / `submitForm` / `sendMessage` → `user.type`,
  `user.keyboard("{Enter}")` / `user.type(textarea, "...{Enter}")`,
  `user.type(textarea, "{Shift>}{Enter}{/Shift}")`, `user.click(sendButton)`.
- `clickNewConversation` / `selectSidebarConversation` →
  `user.click(screen.getByRole("button", { name: /new conversation/i }))` and
  `within(nav).getByRole("button", { name: title })`.
- `messageTexts` / `isPending` / `sidebarReplyingCount` → keep as small reads
  but source from `screen`/`within` queries (e.g. `within(getLog()).getAllByRole("listitem")`).
  The pending turn renders as a `<li data-pending>` inside the same log list, so
  `getAllByRole("listitem")` counts it — exactly as today's `querySelectorAll("li")`
  does. The exact-count assertions (`toHaveLength(2)` / `(4)`) are therefore
  timing-load-bearing: they run _after_ `awaitReply()` when no pending `<li>`
  exists. Preserve that sequencing; don't read counts mid-pending.
  Where they read non-semantic markers (`[data-pending]`, `[data-replying]`),
  keep the attribute query via `within(...).container`-style scoping or
  `screen.getByRole(...).querySelector` — these are structural signals jsdom
  exposes and there is no ARIA role for them.
- Assertions: prefer jest-dom (`toBeDisabled`, `toHaveValue("")`,
  `toBeInTheDocument`) over `.disabled` / `.value` reads where it reads cleaner;
  keep semantics identical.
- `awaitReply` → `act(() => vi.advanceTimersByTime(STUB_REPLY_DELAY_MS))` with
  `act` from `@testing-library/react` (KTD2).
- **Double-submit test** → `fireEvent.submit(form)` twice synchronously (KTD3).
  The `<form>` in `composer.tsx` has no role/accessible name, so `screen` can't
  reach it — obtain it from the `container` returned by `render()`
  (`container.querySelector("form")`), the one place this file uses `container`.
- **Throw test** → keep `expect(() => act(() => vi.advanceTimersByTime(...)))
.toThrow("reply boom")`; the synchronous throw propagates out of the timer
  callback exactly as today. Re-verify it still throws under RTL's `act`.
- **Unmount-race test** → use the `unmount` returned by `render` instead of a
  bespoke local root; keep the `console.error` spy and `vi.getTimerCount()`
  assertions.
- The "jsdom does not simulate native textarea newline on keydown" comment and
  the Shift+Enter no-send-half note survive (still true under user-event).

**Patterns to follow:** RTL `screen` + `within` + `user-event` idioms; preserve
the existing `describe` blocks ("AppShell", "Sidebar shell") and test titles.

**Execution note:** migrate test-by-test, running `pnpm --filter @forge/chat
test app-shell` after each cluster, so a green→green diff is verifiable per
assertion rather than as one big-bang rewrite.

**Test scenarios:** this _is_ a test file — no new behavior. The bar is
preservation. Each of the 30 existing cases must keep its assertion semantics:

- Empty-state present → gone after first send (before reply).
- Append user message; pending shown; textarea + send disabled; reply arrives;
  re-enabled; exactly 2 messages.
- Reply equals `buildStubReply(text)`.
- Send disabled on empty/whitespace; enabled on real text; whitespace submit is
  a no-op leaving empty state.
- Rapid double-submit → 2 messages not 4 (KTD3).
- Enter sends; Shift+Enter does not (value retained).
- Input clears on send.
- Pending timer cleaned on unmount, no `console.error`, timer count 0.
- History append-only, alternating roles across two exchanges.
- Conversation exposed as labeled `log` with the pending turn inside it; textarea
  labeled "Message".
- New-conversation action starts a fresh empty conversation; prior one persists
  in the rail with its derived title (not the "New conversation" placeholder).
- Reply routed to its originating conversation across a mid-reply switch.
- Pending pulse attaches to the awaiting conversation, not the active one.
- Second conversation can send while the first is pending; each reply lands in
  its own conversation.
- Prior conversation's messages restored on reselect.
- Reply-generation throw releases the pending slot (slot-leak guard) and a fresh
  send afterward resolves cleanly.
- Reselecting the active conversation is a no-op that keeps the draft.
- Sidebar: starts expanded (wordmark, collapse toggle, conversation list);
  collapse/re-expand toggle swap; mobile drawer open via menu / close via X with
  `aria-expanded` + `role="dialog"` toggle; Escape closes; scrim click closes;
  New conversation closes drawer; selecting a non-active conversation navigates
  - closes; `<main>` `inert` only while open; body scroll lock + restore; focus
    moves to the close button on open.

**Verification:** `pnpm --filter @forge/chat test app-shell` green with the same
test count (30). No `createRoot`, no `IS_REACT_ACT_ENVIRONMENT`, no
value-setter, no raw `KeyboardEvent`/`dispatchEvent(new Event("submit"`) remain
in the file.

---

### U4. Migrate use-sidebar-chrome.test.ts to renderHook

**Goal:** the hook's seven tests run through `renderHook` (`result.current` +
`rerender`), with the module-level `latest` + `useEffect`-capture `Harness`
deleted.

**Requirements:** R3, R5.

**Dependencies:** U2.

**Files:**

- `apps/chat/src/components/shell/use-sidebar-chrome.test.ts` (rewrite)

**Approach:** Use `renderHook((props) => useSidebarChrome(props), { initialProps:
base })`; read `result.current.clip` / `.handleToggleCollapsed()` /
`.handleTransitionEnd(...)`; drive prop changes with `rerender(newProps)`. Keep
`vi.useFakeTimers()` for the 400ms-fallback test. Wrap state-mutating calls
(`handleToggleCollapsed`, `handleTransitionEnd`, timer advances, document keydown
dispatch) in `act` from `@testing-library/react`. For the two focus-target tests,
follow KTD4 (primary: append a button to `document.body`, assign
`result.current.closeRef.current`, `rerender({ mobileOpen: true })`; fallback:
a 3-line RTL-rendered component). Delete `Harness`, `latest`, and the manual
`createRoot`/`container` scaffolding.

**Patterns to follow:** `renderHook` from `@testing-library/react`; existing test
titles and `base` props object.

**Test scenarios (preserve all seven):**

- Clips while expanded; a settled collapsed rail does not clip.
- Clips through the collapse animation until the width `transitionend`.
- Ignores non-width (`opacity`) transitions when clearing the animating flag.
- Falls back to clearing the animating flag after 400ms if `transitionend` never
  fires.
- Closes the mobile drawer on Escape only while open; other keys ignored.
- Focuses the close button when the drawer opens (DOM target per KTD4).
- Removes the Escape listener when the drawer closes.

**Verification:** `pnpm --filter @forge/chat test use-sidebar-chrome` green, 7
tests. No `latest`, no `useEffect`-capture `Harness`, no `createRoot` in the
file.

---

### U5. Migrate the three sidebar component test files to RTL

**Goal:** `sidebar-header.test.tsx`, `sidebar-conversation-list.test.tsx`, and
`sidebar-new-conversation.test.tsx` use `render` / `screen` / `user-event`, with
their per-file `createRoot`/`act` harnesses and `buttonByLabel`/`clickByLabel`
helpers gone.

**Requirements:** R3, R5.

**Dependencies:** U2.

**Files:**

- `apps/chat/src/components/shell/sidebar-header.test.tsx` (rewrite)
- `apps/chat/src/components/shell/sidebar-conversation-list.test.tsx` (rewrite)
- `apps/chat/src/components/shell/sidebar-new-conversation.test.tsx` (rewrite)

**Approach:** Keep each file's local `render(overrides)` prop-defaulting wrapper
(it's a useful per-component fixture, not the retired DOM harness) but have it
call RTL `render(...)` instead of `createRoot`/`act`. Replace `buttonByLabel` →
`screen.getByRole("button", { name })` / `queryByRole` for absence;
`clickByLabel` → `await user.click(...)`; raw `.click()` → `user.click`. Keep
`createRef` usage for the `forwards closeRef` test (asserting `closeRef.current`
equals the close button — that's a ref-forwarding contract, query the button via
`screen`). Drop `IS_REACT_ACT_ENVIRONMENT` and the `container`/`root`
scaffolding.

**Patterns to follow:** the same `screen`/`user-event`/`within` idioms as U3;
preserve each file's `describe`/`it` titles and the `collapsedStyles(...)` /
`Conversation[]` fixtures.

**Test scenarios (preserve all):**

- _sidebar-header (7):_ collapse toggle shown (expand hidden) when expanded +
  wordmark present; expand affordance shown (collapse hidden) when collapsed;
  `onToggleCollapsed` fires from each control; mobile close button renders in
  both collapsed states; `onCloseMobile` fires from it; `closeRef` forwarded to
  the close button.
- _sidebar-conversation-list (4):_ row click fires `onSelect(id)` +
  `onCloseMobile` once each; only the active row has `aria-current="true"`;
  replying pulse + "Replying" sr-only label only on pending conversations;
  labeled nav with zero rows when empty.
- _sidebar-new-conversation (2):_ renders the labeled action; click fires `onNew`
  - `onCloseMobile` once each.

**Verification:** `pnpm --filter @forge/chat test sidebar-header
sidebar-conversation-list sidebar-new-conversation` green with the same counts
(7 / 4 / 2). Grep-clean of the retired plumbing in all three.

---

### U6. Update apps/chat/CLAUDE.md and run the full verification sweep

**Goal:** the chat conventions record the deliberate RTL divergence and the
browser-verify caveat; the whole suite + lint + typecheck pass; the grep
verification is clean.

**Requirements:** R4, R5, R6.

**Dependencies:** U3, U4, U5.

**Files:**

- `apps/chat/CLAUDE.md` (modify "Key Conventions" → the testing bullet)

**Approach:** Rewrite the testing-convention bullet that currently mandates
"plain `react-dom/client` + `act` with per-file `// @vitest-environment jsdom`
(the `apps/admin` style — no testing-library)". Replace with: chat uses RTL +
`user-event` + `jest-dom` (jsdom is the app default via `vitest.config.ts` +
`vitest.setup.ts`); the hook test uses `renderHook`; pure-function tests stay
plain vitest. State explicitly that this is a **deliberate divergence** from the
`apps/admin`/`apps/web` no-testing-library convention, scoped to chat. Keep the
existing note that focus-restore-on-close / layout-visibility behavior is
**browser-verified** because jsdom has no layout. Respect the 3-line inline
comment / concise-prose conventions of that file.

**Patterns to follow:** the existing "Key Conventions" bullet style and the
"Comments" cap in the same file.

**Test scenarios:** Test expectation: none — docs. Behavior coverage is verified
by the full-suite run below.

**Verification (the origin ticket's full checklist):**

- `pnpm --filter @forge/chat test` — all 8 files / 63 tests pass; assertion
  count not reduced.
- `pnpm --filter @forge/chat lint` and `pnpm --filter @forge/chat typecheck` —
  clean.
- Grep clean across `apps/chat/src`: no `IS_REACT_ACT_ENVIRONMENT`, no
  `Object.getOwnPropertyDescriptor(HTMLTextAreaElement`, no
  `dispatchEvent(new KeyboardEvent`, no `dispatchEvent(new Event("submit"`, no
  `createRoot(`, no bare `import { act } from "react"` harness in the migrated
  component tests. (RTL `act`/`fireEvent` per KTD2/KTD3 are expected and allowed.)
- No `// @vitest-environment jsdom` directives remain.
- `use-sidebar-chrome.test.ts` uses `renderHook`, no module-level `latest`.
- `apps/chat/CLAUDE.md` reflects the new convention + browser-verify caveat.
- `docs/solutions/best-practices/unit-testing-react-hooks-plain-react-dom-act-*.md`
  remains absent (R6 — already confirmed gone).

---

## Scope Boundaries

**In scope:** `apps/chat` test mechanism only — deps, vitest config/setup, the
five DOM test files, and `apps/chat/CLAUDE.md`.

**Out of scope (origin Constraints):**

- `apps/admin` and `apps/web` tests, and any root-level RTL addition — the
  divergence is chat-only by design.
- The feat-205 async Mastra wiring. This plan lands RTL _before_ it so those
  tests start in RTL, but does not touch reply timing, `chat-stub.ts`, or
  `use-conversations.ts`. The synchronous-stub timer/throw assertions are
  migrated **as-is** (KTD2), not reshaped for async.
- Folding into the feat-203 sidebar PR — this is a separate PR (origin
  Constraint).
- Any production-code change under `apps/chat/src/components` or `src/lib`.

### Deferred to Follow-Up Work

- None. If U3's `screen.getByRole(...)` queries reveal a missing accessible name
  on the send button (composer), prefer fixing the query within this PR over a
  production a11y change; only if a real a11y gap surfaces, file a follow-up
  rather than expanding scope here.

---

## Risks & Mitigations

- **`user-event` hangs under fake timers.** Highest-likelihood failure. Mitigated
  by KTD1 (`advanceTimers: vi.advanceTimersByTime`). If a test mysteriously times
  out, this is the first suspect.
- **Accessible-name drift.** Role/name queries assume the components expose the
  accessible names the current attribute queries rely on (`aria-label="Message"`,
  `role="log"` name "Conversation", nav name "Conversations", button labels
  "Collapse sidebar"/"Open sidebar"/"Close sidebar"/"Open menu"). These are all
  present in the current tests' attribute reads, so the names exist — but the
  send button's accessible name must be confirmed against `composer.tsx` at impl
  time (U3 approach note).
- **Over-zealous grep cleanup.** RTL's `act` and `fireEvent` legitimately remain
  (KTD2/KTD3). Mitigated by spelling the allowed survivors into U6's grep
  verification so code review doesn't flag them as incomplete migration.
- **The throw test under RTL `act`.** `act` rethrows, so the synchronous
  `toThrow("reply boom")` should hold, but verify explicitly (U3) — `act`'s error
  handling differs subtly from a bare timer advance.
- **Worktree install truncation (environmental).** A fresh-worktree `pnpm install`
  has been seen to truncate large `node_modules` files to 8 MiB (esbuild EPIPE /
  `typescript.js` SyntaxError). Baseline suite already ran green in this worktree,
  so the risk is low, but a re-install after U1 could re-trigger it — see
  `docs/solutions/build-errors/worktree-pnpm-install-8mb-file-truncation-20260624.md`
  if test/lint suddenly crash.

---

## Verification (rollup)

The whole change is done when, from the worktree:

1. `pnpm --filter @forge/chat test` → 8 files, 63 tests, all green.
2. `pnpm --filter @forge/chat lint` → clean.
3. `pnpm --filter @forge/chat typecheck` → clean.
4. The grep sweep in U6 returns no retired-plumbing hits and no
   `@vitest-environment` directives.
5. `git diff --stat` touches only: `apps/chat/package.json`, `pnpm-lock.yaml`,
   `apps/chat/vitest.config.ts`, `apps/chat/vitest.setup.ts`, the five
   `apps/chat/src/components/shell/*.test.ts(x)` files, `apps/chat/CLAUDE.md`,
   and this plan doc — nothing under `apps/admin`, `apps/web`, the repo root, or
   `apps/chat/src` production files.

---

## Sources & Research

- Origin ticket: `docs/roadmap/ai-chat/feat-206-chat-introduce-react-testing-library.md`.
- Lane conventions: `docs/roadmap/ai-chat/CLAUDE.md` (status/README upkeep on
  completion — a `## Resolution` section + README row update are part of "done"
  when the code PR merges; tracked for the close-out, not this plan's code).
- App conventions: `apps/chat/CLAUDE.md` ("Key Conventions", "Comments", stub
  seam ownership of reply timing).
- Current published, React-19-compatible versions (looked up during planning):
  `@testing-library/react` 16.3.2, `@testing-library/dom` 10.4.1,
  `@testing-library/user-event` 14.6.1, `@testing-library/jest-dom` 6.9.1.
- Baseline confirmed during planning: 8 files / 63 tests green; five files carry
  `@vitest-environment jsdom` + `IS_REACT_ACT_ENVIRONMENT` + `react-dom/client`;
  the three pure-function files do not; the retired solutions doc is already
  absent on `main`.
