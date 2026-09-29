---
id: "feat-572"
title: "Devotional message-first pipeline with context and language research"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-09-29"
duration: 7
depends_on: []
blocks: []
tags:
  - "ai-pipeline"
  - "mastra"
---

## Problem

The devotional text agents never share one stated message. The point picker
decides what the piece is about but writes that decision nowhere; the
modernizer, copywriter and conclusion writer each re-infer the idea from the
reflection text, and the narrative editor formulates the throughline only at
the end, for review, and passes it to nobody. The checks can only reject: their
reasons are logged and never reach the writer.

The historical-context and original-language sections the owner wants (the
Vineyard devotional, 2026-09, credited to Bible Odyssey and Thayer) are not
produced by any agent: that script was authored by hand in
`apps/mastra/src/scripts/author-vineyard-devotional.ts`.

## Entry Points — Read These First

1. `apps/mastra/src/services/devotional/generate-devotional.ts`, `composeDevotionalContent`: the current order (source → pickPoints → modernize → writeCopy → writeConclusion → pickHighlights).
2. `apps/mastra/src/services/devotional/devotional-quality-gate.ts`, `reviewDevotionalText`: voice rules, coherence, depth, narrative editor, fidelity.
3. `apps/mastra/src/services/devotional/narrative-editor.ts`: the only place a throughline is formulated today.
4. `apps/mastra/src/services/devotional/devotional-models.ts`: per-agent models (point picker and conclusion writer are on gpt-4o, the writer on claude-sonnet-4.5).
5. `apps/mastra/src/scripts/author-vineyard-devotional.ts`: the hand-authored target shape (paragraph voices, `SourceMark` with `evidence`).
6. `apps/mastra/src/services/devotional/reflection-corpus.ts`: how the public-domain commentary corpora are loaded (the model for new reference corpora).

## Grep These

- `pickReflectionPoints|modernizeReflection|writeDevotionalCopy|writeDevotionalConclusion`
- `reviewNarrative|throughline`
- `critiqueReflection|depthScore`
- `SourceMark|evidence`

## What To Build

Stages, in order:

1. **Source**: scene, verse, classic commentary, point picker (as today).
2. **Message** (new agent): sees scene, verse, clip transcript and the chosen
   classic points; returns
   ```ts
   type DevotionalMessage = {
     idea: string // what the viewer should carry away, 1-2 sentences
     tension: string // what in the story resists that idea
     askDirection: string // where the personal question should point, not the question
   }
   ```
   Human approval gate before anything downstream runs (same mechanism as
   `devotional-text-approval.ts`).
3. **Depth** (two new agents), each given verse, scene, classic points AND the
   message:
   - historical / cultural / social / economic / religious context, 1-2 facts;
   - original language: one Greek or Hebrew word that changes the reading.
     Each returns `{ fact, quote, source, why }[]`, or `nothing-useful`, or
     `conflict` (the text does not support the message). Rule: do not search for
     evidence to prove the message; search for what helps the viewer read the
     text accurately; reject anything that stretches the source or the passage.
     A `conflict` stops the run and returns to the message gate. Quotes are
     verified in code against the corpus (like `checkQuotations`).
     Corpora: public-domain reference works only (Thayer 1889, Strong 1890,
     Easton 1897, ISBE 1915, Smith), loaded like the commentary corpora.
4. **Reflection**: the modernizer gets the message, classic points and depth
   facts; writes one continuous text, tags each paragraph with its source so
   `SourceMark` + `evidence` are built from the tags. No section announcements
   in speech ("now some historical context"); naming a source inside a
   sentence is fine.
5. **Ending**: takeaway first, then question and prayer from the FINAL
   reflection + takeaway (message as guidance). Keep the current
   question/prayer writer as the A/B baseline: the owner has liked its output.
6. **Packaging**: title and opening hook from the message's tension;
   highlights; attribution.
7. **Validation**: every check receives the message. Depth becomes a checklist
   with PASS / NEEDS REVISION + reason (not a 1-5 score). NEEDS REVISION
   reasons go back to the writer for one or two targeted rewrites before the
   run stops.

## Constraints

- The message never overrides Scripture: the verse and the passage bound it.
- No copyrighted reference text in corpora (Bible Odyssey / SBL is out).
- Existing JESUS-film generation must keep working until the new path is
  proven; land it behind a flag, default off.
- No em/en dashes in generated copy (`stripDashes` still applies).

## Verification

- Run the new path end to end on an unused LUMO parable (first test: the
  Prodigal Son, Luke 15:11-32, `6_GOLuke2616`) and compare with the current
  path on the same inputs: message, depth notes with verified quotes, reflection,
  question and prayer side by side for the owner.
- `pnpm --filter @forge/mastra exec vitest run src/services/devotional`
- Every depth quote found verbatim in its corpus (test).
- A `conflict` from a depth agent stops the run before the writer (test).
