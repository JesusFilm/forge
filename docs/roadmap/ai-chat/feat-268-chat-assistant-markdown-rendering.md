---
id: "feat-268"
title: "Chat assistant markdown rendering (hardened, no raw HTML)"
owner: "jian wei"
priority: "P1"
status: "complete"
start_date: "2026-07-16"
duration: 3
depends_on: []
blocks: []
tags:
  - "web"
---

## Resolution

**Shipped:** 2026-07-20 via [PR #1620](https://github.com/JesusFilm/forge/pull/1620) (`feat(chat): render assistant markdown with hardened containment (feat-268)`).

**What landed.** Assistant turns render through `react-markdown@^10.1.0` + `remark-breaks` behind an element allowlist (`p/strong/em/ul/ol/li/blockquote/code/a/br`) with `unwrapDisallowed`; no `rehype-raw`, `skipHtml` stays false, zero `dangerouslySetInnerHTML` — the discipline reworded to "no raw HTML ever reaches the DOM". Links are https-only through a shared `UntrustedLink` gate (`isHttpsUrl` lifted to `lib/is-https-url.ts`), so `assistant-markdown` and `sources-list` share one hardened anchor and can't drift. User turns stay React-escaped plain text. Scope grew during review: because chat has no app-level error boundary and turns persist (feat-208) + replay (feat-241), an adversarial code-review reproduced a durable crash/freeze from pathological input, so containment shipped as THREE independent controls — a pre-parse prefix guard (short deep-nesting crash), a shape-agnostic length cap at the 8,192-unit per-message ceiling (the `*_*_…` emphasis-nesting freeze the prefix regex is blind to, reproduced at ~2 s at 24 KB), and a per-turn `MarkdownRenderBoundary`. The Seeker-side cite-by-name follow-up in the brief was left out of scope. Rebased past the concurrently-merged feat-269 sources disclosure, whose inline anchor was folded onto the shared `UntrustedLink`.

**Compound docs.** [Guard recursive markdown rendering against untrusted-content crash and freeze](../../solutions/best-practices/react-markdown-untrusted-nesting-crash-freeze-guard.md) — the shape/depth axis of input bounding, sibling to the byte-cap (SIZE) and outbound-timeout (TIME) laws (ce-doc-review applied: three-layer completeness correction, render-model-scoped containment, MDX exclusion). Root `CLAUDE.md` Known-Patterns bullet added; the feat-240 ticket's stale plain-text-rendering mitigation got a dated supersession note.

**Residual risk / follow-ups.** apps/web's existing react-markdown surfaces (`Text.tsx` server-rendered, `RelatedQuestions.tsx` client) render admin-sourced, partly AI-generated content and were NOT audited for this exposure — flagged in the compound doc's "When to Apply" as a verify-when-touched item, not a known defect.

## Problem

The 2026-07-15 UI audit's biggest finding: Seeker emits markdown and chat
renders it as literal text. Real replies showed `*   **Doubt as a Catalyst for
Faith:**` with raw asterisks, `> "Trust in the Lord…` blockquotes as
angle-bracket lines, and inline citations as fully spelled-out
`["title"](https://…)` — URLs mid-sentence, hundreds of characters long.
Replies look broken and are genuinely hard to read.

This is deliberate today: `apps/chat/CLAUDE.md` records the plain-text
rendering discipline ("message content renders as React-escaped text only — no
`dangerouslySetInnerHTML`, no HTML, no markdown; keep it that way") as a
session-cookie XSS mitigation. That discipline is a security posture, not a
formatting mandate — a markdown pipeline that never emits raw HTML preserves
it. This ticket updates the discipline's wording alongside the implementation.

## Entry Points — Read These First

1. `apps/chat/src/components/chat/message-list.tsx` — assistant turns render
   `message.content` as escaped text inside a `whitespace-pre-wrap` block;
   this is the seam that gains the markdown renderer. User turns stay
   plain text.
2. `apps/chat/src/components/chat/sources-list.tsx` — the existing untrusted-
   content discipline to mirror: `isHttpsUrl` gate, `rel="noopener
noreferrer"`, text never HTML.
3. `apps/chat/src/lib/use-conversations.ts` — replay path (feat-241): replayed
   turns flow through the same `MessageList`; whatever renders live turns must
   render replayed ones identically (R21 parity — replay currently strips
   badges, which stays; the TEXT treatment must not diverge).
4. `apps/chat/CLAUDE.md` — the plain-text discipline paragraphs (Authentication
   section + Intentionally Absent) to amend: the invariant becomes "no raw
   HTML ever reaches the DOM", not "no markdown".

## Grep These

- `whitespace-pre-wrap` in `apps/chat/src` — the current text rendering.
- `dangerouslySetInnerHTML` — must stay ZERO hits after the change.
- `isHttpsUrl` — the link-protocol gate to reuse (export it or lift to a
  shared module rather than duplicating).

## What To Build

- A hardened markdown renderer for ASSISTANT turns only (e.g. `react-markdown`
  with `skipHtml`/no `rehype-raw`, or an equivalent that never parses raw
  HTML). Element allowlist only: paragraphs, `strong`/`em`, ordered/unordered
  lists, blockquote (styled with the `font-scripture` treatment where it fits
  the Vigil system), inline code, and links.
- Links: https-only (reuse the `isHttpsUrl` gate), `target="_blank"`,
  `rel="noopener noreferrer"`, styled like the sources-list links. Everything
  failing the gate renders as plain text.
- Streaming: the renderer re-parses the growing partial text each token —
  verify incomplete markdown mid-stream (unclosed `**`, a half-typed link)
  degrades to visible text rather than throwing or flickering badly.
- Replay parity: replayed transcripts get the same renderer (bare-text badges
  stay stripped per R21).
- Update the two `apps/chat/CLAUDE.md` discipline paragraphs to the new
  invariant wording in the same PR.
- OPTIONAL complement (separate follow-up if pursued): instruct the Seeker
  agent (`apps/mastra/src/mastra/agents/seeker-agent.ts`) to cite by source
  name instead of inline markdown links — the sources list below the reply
  already carries the URLs. Decide during implementation; do not block on it.

## Constraints

- `dangerouslySetInnerHTML` stays banned. No `rehype-raw`, no HTML passthrough,
  no `srcdoc`/iframe anything. The renderer's output must be React elements
  from the allowlist only.
- User messages stay React-escaped plain text — markdown applies to assistant
  turns only.
- No fourth font, no new colors: style the markdown elements with existing
  Vigil tokens.
- Keep bundle impact proportionate — this is the chat app's first rendering
  dependency; prefer a small pipeline over a kitchen-sink preset.

## Verification

```bash
pnpm --filter @forge/chat typecheck && pnpm --filter @forge/chat lint && pnpm --filter @forge/chat test
grep -rn "dangerouslySetInnerHTML" apps/chat/src   # zero hits
```

- Component tests: bold/list/blockquote/link markdown renders as elements;
  raw `<script>` / `<img onerror>` in content renders as inert text; an
  `http:`/`javascript:` link renders as plain text.
- Browser: a live Seeker reply shows formatted bold/lists/quotes; reload +
  replay the thread — identical text formatting, no badges.
