---
id: "feat-401"
title: "Sidebar: no placeholder row for an unstarted conversation"
owner: "jian wei"
priority: "P3"
status: "in-progress"
start_date: "2026-09-01"
duration: 1
depends_on:
  - "feat-399"
blocks: []
tags:
  - "web"
---

## Problem

Pressing the rail's "New conversation" action inserts a **row also labelled
"New conversation"** into the conversation list directly beneath it, and
selects it. Two controls a few pixels apart carry the same words and mean
different things (an action vs. a destination). Clicking any real conversation
then makes that row vanish, so the list grows and shrinks under the cursor —
list instability that reads as a glitch rather than a state change.

`listConversations` (`apps/chat/src/components/shell/sidebar-projection.ts`)
already argues the other half of this case in its own docstring — it hides
never-used empty local conversations that are NOT active, calling an inactive
empty "pure clutter under the identically-labeled action button". The same
reasoning applies to the ACTIVE empty row; it was simply not extended there.

Proposal: an unstarted conversation gets no sidebar row. Pressing New shows the
"What would you like to ask?" empty state with nothing selected in the rail; the
row appears when the conversation becomes real (first send), which the existing
`messages.length > 0` clause already does with no new logic.

**Reach:** the placeholder row renders on every New press in every session,
signed-in and anonymous alike — unlike feat-402, whose pane needs a
gate-granted visitor with a broken deep link. Schedule this one first.

**Alternatives considered.** The complaint that triggered this ticket was the
duplicate LABEL, and the cheaper fix for exactly that is a one-constant rename:
`NEW_CONVERSATION_TITLE` (`apps/chat/src/lib/conversations.ts`) has one
production call site (`createConversation`) and one test. Renaming the ROW
title dissolves the collision with no test churn and no deep-link regression
risk. Row removal is still preferred — but for the OTHER half of the problem,
which the rename does not touch: the list growing and shrinking under the
cursor. If that instability is judged acceptable, take the rename instead.

Corroborating aside (not the argument): ChatGPT and Claude both show a new chat
with no sidebar row until the first message.

Pre-existing since feat-270; NOT introduced by feat-399, though feat-399's
granted-malformed shell is one more surface that renders the placeholder row
beside real history and would read better without it.

## Entry Points — Read These First

1. `apps/chat/src/components/shell/sidebar-projection.ts` — `listConversations`
   is the whole visible-row policy. The `c.id === activeId` disjunct in its
   filter is the placeholder row.
2. `apps/chat/src/components/shell/sidebar-projection.test.ts` — TWO tests
   invert, not one. `"keeps the ACTIVE empty local conversation pinned on top"`
   obviously does. So does `"keeps empty SERVER rows even when inactive"`
   (`:47`): its fixture holds the empty LOCAL row `"fresh"` as `activeId` and
   expects `["fresh", "server-row"]`, which becomes `["server-row"]` — re-cut
   the expectation and KEEP the fixture, since it is what still proves the
   `origin === "server"` clause fires. Only the inactive-empty case (`:17`)
   stays green unchanged. Re-cut deliberately; delete nothing.
3. `apps/chat/src/lib/conversation-session.ts` — `orderConversations` (the
   fresh-empty-pinned-on-top ordering the projection wraps) and
   `newConversation` (feat-270 reuse: pressing New while already on a fresh
   empty conversation is a full no-op and mints nothing).
4. `apps/chat/src/components/shell/app-shell.deeplink.test.tsx` — the feat-399
   test `"RELEASES the pane from the ACTIVE landing row — the natural escape"`
   CLICKS the placeholder row, so this change makes it unrunnable as written.
   Disposition: re-cut it onto the rail's New ACTION, which is also a no-op
   release on that shell, so the explicit-dismiss mechanism stays covered by a
   case where no id moves. In the same PR, refresh the feat-399 row in
   `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`,
   which cites that fixture BY NAME as the mechanism-discriminating case.
5. `apps/chat/src/components/shell/app-shell.tsx` — `newConversationFocused`;
   the composer focus is the only remaining acknowledgement of a no-op New
   press once the highlighted row is gone.

## Grep These

- `c.id === activeId` in `sidebar-projection.ts` — the one production clause.
- `navRowTitles()` across `apps/chat/src/components/shell/*.test.tsx` — do NOT
  work to a fixed count; enumerate with the grep. The assertions span
  `app-shell.test.tsx`, `app-shell.history.test.tsx` and
  `app-shell.deeplink.test.tsx`, and each needs re-reading to decide whether it
  meant the ROW or the ACTION.
- The literal `"New conversation"` inside `getConversationNav()`-scoped
  helpers — these are CLICK sites the `navRowTitles()` pattern cannot reach,
  and they THROW rather than fail an assertion once the row is gone:
  `selectSidebarConversation("New conversation")` (`app-shell.test.tsx:260`)
  and `selectRow("New conversation")` (`app-shell.deeplink.test.tsx:372`), plus
  the in-nav `getByRole` + `aria-current` pair in `app-shell.history.test.tsx`.
- `getNewConversationAction` in `app-shell-test-harness.tsx` — the helper that
  distinguishes the rail ACTION from a same-named row by excluding `<nav>`.
  If the row can no longer exist, note whether the helper's exclusion is still
  load-bearing or becomes vacuous.
- `aria-current` in `sidebar-conversation-list.tsx` — the selected-row marker
  that will be absent for an unstarted conversation.

## What To Build

One-clause change plus its test consequences:

```ts
// apps/chat/src/components/shell/sidebar-projection.ts
export function listConversations(
  conversations: Conversation[],
  activeId: string,
): Conversation[] {
  return orderConversations(conversations, activeId).filter(
    (c) => c.origin === "server" || c.messages.length > 0,
  )
}
```

Keep `origin === "server"` FIRST: an adopted deep-link row (feat-209) is
server-origin with zero messages and must stay visible — dropping the
`activeId` disjunct must not hide it. Add a discriminating test for that row
specifically, holding it ACTIVE, or the change silently breaks deep links.

Decide and record one open question — with its premise stated correctly.
Pressing New while already on an unstarted conversation is ALREADY a complete
no-op today (`newConversation()` returns early when `existing.id === activeId`),
and the row was already highlighted, so the press gives no feedback before this
change either. What actually changes is ambient state indication, not press
acknowledgement. The real question: is the empty-state pane sufficient
indication that nothing is selected?

One genuine gap that IS worth deciding, because the no-op branch never reaches
`draft = ""`: a user who typed a partial message and pressed New to start over
gets no row change, no draft reset, and — since the composer was already
focused — no perceptible feedback at all. Clearing the draft in
`newConversationFocused` (via the existing `setDraft("")`) fixes it without
touching `newConversation`'s protected reuse semantics; add a verification case
for "draft present + press New while already unstarted". Do not add a row back
to solve any of this.

**DECIDED 2026-08-21 — do NOT clear the draft. This paragraph's prescription is
superseded; the rest of the ticket stands.** The draft clear was built, tried in
the browser, and rejected by the owner. The paragraph's premise is what failed:
it treats "no perceptible feedback" as a gap, but pressing New on an already
unstarted conversation SHOULD be a dead button, and silence is the correct
answer rather than a defect. Checked against prior art — Claude and Gemini both
KEEP a typed draft across a New press. Discarding text the user typed is the
worse failure by a wide margin: the feedback it buys is not worth it, and there
is no undo. `newConversationFocused` therefore does not call `setDraft("")`, and
`app-shell.test.tsx` keeps the feat-270 case "keeps the draft when New lands on
the already-empty active pane" unchanged. The row-removal half of this ticket is
unaffected — it was implemented as specified.

## Constraints

- Do NOT change `orderConversations` — but for the right reason. feat-209 R3's
  ACTIVE adopted-server-row pin still governs a visible row, which is why the
  function stays. Its fresh-empty-local branch, however, becomes UNOBSERVABLE
  through this projection: it pins rows matching
  `origin !== "server" && messages.length === 0`, and after the filter becomes
  `origin === "server" || messages.length > 0` no row can satisfy both. Record
  that so a later reader does not mistake the dead branch for live policy — and
  note the earlier draft of this ticket justified the pin by "the moment a row
  does appear", which is wrong: by then the row is no longer empty.
- Do NOT delay the row past first SEND (e.g. to first keystroke). Send is the
  point the conversation becomes real and server-persistable; a draft is not.
- Do NOT remove or relabel the rail's New ACTION button.
- Do NOT alter `newConversation`'s feat-270 reuse semantics; this is a
  presentation change only, and the session must still mint at most one fresh
  local conversation.
- Anonymous, gate-denied, and denial-shell rails must be unaffected beyond
  losing the same placeholder row.

## Verification

- Signed-in gate-granted: press New → empty state renders, NO "New
  conversation" row in the rail, nothing marked `aria-current`; send one
  message → a row appears immediately, titled from the message, and the
  "Replying" pulse lands on it.
- Press New, then click an existing conversation, then press New again: the
  rail list length never changes except when a conversation is genuinely
  created.
- Deep link `/c/<valid-uuid>` for an existing thread: the adopted row is still
  visible while active with zero replayed messages (the `origin === "server"`
  clause) — falsify by removing that clause and confirm this goes red.
- Anonymous: rail behaves identically minus the placeholder row; refresh still
  resets.
- `pnpm --filter @forge/chat test && pnpm --filter @forge/chat lint && pnpm --filter @forge/chat typecheck`
- A first-time signed-in user with no server history now sees a COMPLETELY
  EMPTY rail list — a state that cannot occur today, since the fresh local row
  is always present. `sidebar-conversation-list.tsx` has no empty-state branch.
  Decide whether that needs copy or spacing, or is acceptable bare.
- Browser check of the rail on desktop expanded, desktop collapsed (icon rail),
  and the mobile drawer — the empty rail state is a layout case worth seeing.
