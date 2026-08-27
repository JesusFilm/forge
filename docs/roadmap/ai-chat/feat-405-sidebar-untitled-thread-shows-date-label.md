---
id: "feat-405"
title: "Sidebar: untitled threads show a date label until you open them"
owner: "jian wei"
priority: "P2"
status: "not-started"
start_date: "2026-09-01"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
---

## Problem

A conversation with a real question in it renders in the rail as
`Conversation — 21 Aug`. Clicking it restores the proper title; refreshing
loses it again. Observed locally and in production (2026-08-21), on the
signed-in gate-granted sidebar.

The date label is not a rendering bug — it is the UNTITLED state
(`sidebar-conversation-list.tsx:68` renders `fallbackTitle(lastActivityAt)`
whenever `title.trim()` is empty). Those threads genuinely have `title: ""`
stored server-side. Three facts compose into the observed loop:

1.  **Titles come from a free-tier model that is failing.** Mastra's
    `generateTitle` is pinned to `AI_CHAT_TITLE_MODEL` =
    `"openrouter/google/gemma-4-26b-a4b-it:free"`
    (`apps/mastra/src/mastra/ai-chat-memory.ts:107`). Captured from a live
    local run, 2026-08-21:

        "statusCode": 429,
        "raw": "google/gemma-4-26b-a4b-it:free is temporarily rate-limited
                upstream. Please retry shortly, or add your own key..."
        "limit_source": "upstream_provider_shared_pool"

    Titling is fire-and-forget after a completed turn, so a 429 costs the turn
    nothing and leaves the stored title `""`.

2.  **The retry hook is "next turn", so single-turn threads never heal.**
    `buildAiChatMemory`'s docstring states it: titling "fires only for threads
    whose stored title is still empty ... so a title-model failure leaves `""`
    and retries on the next turn." A thread is permanently untitled exactly
    when its title call failed AND it never got another turn. That is why only
    SOME production threads show the label while most carry real LLM titles.

3.  **The client's repair is in-memory only.** On replay,
    `conversation-session.ts:640` runs `titleFromFirstUser(...)`, filling a
    blank title from the first user message. It is never written back, so the
    next refresh discards it.

**Why it always looks like the OTHER conversation.** The thread in the URL is
replayed automatically on load and therefore backfilled; every other row is
lazy and stays unlabelled. Both rows are equally untitled — the open one is
just masked. Two rows in the same rail can appear to swap states on refresh
with nothing else having changed.

Separately benign, do not treat as this bug: a refresh within seconds of a
first turn can legitimately show the label before the fire-and-forget title
lands. That self-heals; this ticket is about the threads that never do.

**Not caused by feat-401.** That change alters which rows render, never their
titles; its only `title`-touching lines are in test files. Confirmed present
in production, which does not carry that branch.

## Entry Points — Read These First

1. `apps/chat/src/components/shell/sidebar-conversation-list.tsx:68` — the
   `fallbackTitle` render. The symptom's surface, almost certainly NOT the
   place to fix.
2. `apps/mastra/src/mastra/ai-chat-memory.ts:107` — `AI_CHAT_TITLE_MODEL`,
   the `:free` pin. Read `buildAiChatMemory`'s docstring directly above it:
   it already documents the empty-title sentinel, the fire-and-forget
   semantics, the next-turn retry rule, and the standing note to revisit
   first-party gateway titling when feat-237's flag is on.
3. `apps/mastra/src/mastra/ai-chat-history-route.ts:373` — the list
   projection, `title: typeof row.title === "string" ? row.title : ""`.
   The natural home for option B below.
4. `apps/chat/src/lib/conversation-session.ts:640` — the `titleFromFirstUser`
   call in the replay path, the client backfill that currently papers over
   this, and `:151` — `mergeServerThreads`, where a
   non-empty server title beats a client snippet and an empty one does not
   clobber.

## Grep These

- `fallbackTitle` — render sites (sidebar rail + the app-shell live-region
  announcement at `app-shell.tsx:160`; both must stay consistent).
- `titleFromFirstUser` — the two backfill sites (`conversation-session.ts`
  `:440` first-send, `:640` replay).
- `AI_CHAT_TITLE_MODEL` / `generateTitle` in `apps/mastra/src/mastra/` —
  the wiring plus its `generateTitle: false` override for non-`user:`
  resources in `aiChatMemoryConfigFor`.
- `"untitled"` and `title: ""` in `ai-chat-history-route.ts` — the wire
  contract prose that calls `""` the untitled sentinel. Any fix that stops
  emitting `""` must correct that prose in the same PR.

## What To Build

Pick one; A and B compose well and are not exclusive.

**A — get titling off the shared free pool (treats the cause).** Point
`AI_CHAT_TITLE_MODEL` at a paid/BYOK route, or add a provider key so the
account is not on `upstream_provider_shared_pool`. Cheapest real cure. Note
the docstring's trust posture: titles send conversation-derived content to a
third-party model, which is why the free tier was chosen; changing route
means re-reading that paragraph, not just the string.

**B — durable server-side fallback (removes the class, no model call).** In
the list projection, when the stored title is empty, derive a label from the
thread's first user message instead of emitting `""`. Deterministic, costs no
tokens, and yields the same string the client already backfills — so the rail
stops changing under the user. This makes the date label near-unreachable,
which is the point; it also RETIRES the `""` untitled sentinel, so update the
wire-contract prose and the client's `fallbackTitle` path deliberately rather
than leaving dead code.

**Considered and not preferred:** persisting the client's backfill (adds a
write path from the browser for something the server can do alone), and
retrying titling at list time (a read path that makes model calls — surprising
and unbounded).

## Constraints

- Do NOT fix this at the render layer by hiding the date label. The label is
  the honest display of an empty title; suppressing it hides the real defect
  and breaks the genuinely-untitled case.
- Do NOT make listing a model-calling path.
- Do NOT title anonymous/dogfood resources: `aiChatMemoryConfigFor` passes
  `generateTitle: false` for non-`user:` resources on purpose (they are
  unlistable under R2, so titling burns a call per junk POST). Option B is
  free of this concern; option A must preserve the override.
- Keep `generateTitle` on the TOP-LEVEL options key. The deprecated
  `threads.generateTitle` nesting throws mid-turn at the first merged-config
  read, not at construction.
- Titling must stay fire-and-forget: it must never delay or fail the turn it
  rides on.

## Verification

- Signed in, gate-granted: send ONE message into a new conversation, wait for
  the reply, refresh. The rail row shows a real title, not
  `Conversation — <date>`. Repeat while the title model is failing (option B
  must hold even then — force it by pointing the title model at a bad route).
- The masking check that makes this bug hard to see: open conversation A,
  refresh, and read the label on conversation B WITHOUT clicking it. B must
  be titled. Pre-fix, B shows the date while A looks fine purely because A is
  replayed on load.
- A genuinely empty thread (no user turn) still renders the date label —
  `fallbackTitle` keeps a reason to exist, or is deliberately removed along
  with its tests.
- `pnpm --filter @forge/chat test && pnpm --filter @forge/mastra test`
- For option A only: confirm no 429 from the title route in the Mastra log
  across several fresh single-turn threads.
