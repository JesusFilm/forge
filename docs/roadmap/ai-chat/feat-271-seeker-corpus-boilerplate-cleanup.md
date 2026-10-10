---
id: "feat-271"
title: "Seeker RAG corpus boilerplate cleanup (scraping artifacts in passages)"
owner: "jian wei"
priority: "P2"
status: "not-started"
start_date: "2026-08-10"
duration: 2
depends_on: []
blocks: []
tags:
  - "ai-pipeline"
---

## Problem

From the 2026-07-15 UI audit: passages returned by the Seeker retrieval path
carry raw scraping/boilerplate artifacts that surface verbatim in the chat UI
(both in cited-source snippets and, via the agent's synthesis, sometimes in
answers). Observed in one real reply's sources:

- a leading `0 100\n\n0` fragment (page counter/score junk) at the top of a
  passage;
- `Subscribe to daily devotional emails!`;
- `Tags:Hebrews Hebrews 1 doubt spiritual questions questions Apologetics`;
- `Photo Credit: Anderson Schmig on Unsplash`.

This is corpus data quality, not a chat rendering bug: the passages arrive
this way from the retrieval service. Cleaning at ingest improves BOTH the
agent's context (junk tokens burn budget and leak into answers — the audited
reply echoed the Tags/Subscribe lines) and the feat-269 source cards.

## Entry Points — Read These First

1. `apps/mastra/src/services/jesusfilm-rag-client.ts` — the retrieval client;
   passages arrive as `RankedResult.text`. First task is tracing where this
   service's corpus is INGESTED — the ingest may live outside this repo (the
   JesusFilm RAG retrieval service), in which case this ticket's deliverable
   is the upstream fix request plus a Mastra-side mitigation.
2. `apps/mastra/src/mastra/tools/retrieve-answer.ts` — the seeker's retrieval
   tool; passages are capped (`MAX_PASSAGE_CODEPOINTS`) but not cleaned. A
   bounded strip-boilerplate pass here is the Mastra-side mitigation seam if
   upstream ingest can't be fixed directly.
3. `docs/roadmap/ai-chat/feat-199-seeker-rag-retrieval-connection.md` — how
   the retrieval connection was set up; pointers to the service's ownership.

## Grep These

- `RankedResult` / `searchJesusfilmRag` — the passage wire shape.
- `MAX_PASSAGE_CODEPOINTS` — the existing per-passage bound the cleanup pass
  would sit beside.

## What To Build

1. **Trace ingest ownership.** Establish where the corpus for the JesusFilm
   RAG service is scraped/chunked (in-repo or external service). Document the
   answer in this ticket.
2. **Fix at ingest if reachable:** strip known boilerplate patterns before
   chunking/embedding — trailing `Tags:` blocks, `Photo Credit:` lines,
   subscribe CTAs, leading numeric counter fragments — and re-embed affected
   documents.
3. **Mastra-side mitigation otherwise:** a conservative, pattern-anchored
   cleanup in `retrieve-answer.ts` applied to passage text before it enters
   the agent context (line-anchored patterns only — e.g. `/^Tags:/`,
   `/^Photo Credit:/`, `/^Subscribe /` — never mid-sentence rewriting), with
   tests over the four observed artifact shapes.

## Constraints

- Never rewrite passage MEANING — strip whole boilerplate lines/blocks only;
  when a pattern is ambiguous, keep the text.
- The cleanup must not alter the `status: ok/empty/unavailable` contract or
  source counts (a passage that becomes empty after stripping is dropped, and
  dropping the last one converts to `empty` semantics — decide + test this
  edge explicitly).
- Snippet text remains untrusted plain text in chat regardless (feat-269's
  constraint) — this ticket does not relax any rendering discipline.

## Verification

- Unit tests over the four observed artifact shapes (fixtures copied verbatim
  from the audit transcript) proving strip behavior + the empty-passage edge.
- Live check: re-ask "Is doubt a sin?" in chat; the cited passages render
  without the counter/Tags/Subscribe/Photo-Credit lines.
