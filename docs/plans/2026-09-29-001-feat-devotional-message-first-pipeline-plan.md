---
title: "feat: Devotional message-first pipeline with context and language research"
type: feat
status: active
date: 2026-09-29
origin: docs/roadmap/media-generation/feat-572-devotional-message-first-pipeline.md
---

# feat: Devotional message-first pipeline with context and language research

## Summary

A second devotional text path, beside `composeDevotionalContent`, that decides
the message first and builds everything from it: a message agent, two depth
agents backed by public-domain reference corpora with code-verified quotes, a
writer that produces tagged paragraphs (voices + source marks + evidence), an
ending written takeaway-first, and an A/B baseline for question and prayer. It
runs from a CLI on a LUMO source and writes the ordinary cached devotional, so
the existing gate, approval, narration and render take it from there. First
run: the Prodigal Son (Luke 15:11-32, LUMO `6_GOLuke2616`).

---

## Problem Frame

See origin. In short: no shared message across agents; historical and language
sections exist only in the hand-authored Vineyard script; checks reject without
telling the writer why.

## Requirements

- R1. A message `{idea, tension, askDirection}` is produced from scene, verse,
  clip text and the classic's chosen points, and passed to every later agent.
- R2. No separate approval stop for the message (owner, 2026-09-29): she
  reviews at the script stage; there she can change the message (downstream
  regenerates), give a note (rewrite), or hand-edit.
- R3. Depth agents (history/culture; original language) may each return
  facts with verbatim quotes, `nothing-useful`, or `conflict`. They search for
  what helps read the text accurately, not for proof of the message. Every
  quote is verified in code against the corpus; an unverifiable fact is
  dropped. A Greek word must occur in the passage (tagged text).
- R4. The writer produces one continuous reflection as tagged paragraphs; no
  section announcements in speech; naming a source inside a sentence is fine.
  Marks and evidence are built from the tags.
- R5. Ending: takeaway, then question and prayer from the final reflection and
  takeaway. The current copywriter's question and prayer are generated too,
  as a blind A/B for the owner.
- R6. Checks receive the message; the narrative editor judges against it.
- R7. Corpora are public domain or open-licensed with attribution only.
- R8. Existing JESUS-film generation is unchanged.

## Scope Boundaries

- Not in this plan: TTS, render, captions and window for the new LUMO source
  beyond what the text needs; hook/teaser rework; RU/ES.
- Depth critic as PASS/NEEDS REVISION checklist and the automatic
  reasons-back-to-writer loop over all checks: first version keeps the
  writer's own voice-repair loop and runs the existing gate after; the
  checklist lands after the owner has compared outputs.

### Deferred to Follow-Up Work

- Fold the path into the Mastra workflow and Studio.
- ISBE (no clean machine-readable copy found); Thayer proper (Abbott-Smith via
  STEPBible TBESG is used instead: PD 1922 text, CC BY packaging).
- Fix: `pickReflectionPoints` sorts chosen indices ascending, discarding the
  picker's order that the composer relies on.

---

## Key Technical Decisions

- **Corpora in `devo/corpus` (gitignored, like the commentaries), built by a
  checked-in ingest script from files kept in `devo/corpus/raw/`.** Sources:
  Easton 1897 and Smith 1863 (CCEL ThML XML via neuu-org's raw copy), STEPBible
  TBESG (Abbott-Smith), STEPBible TAGNT (Greek NT tagged with Strong numbers).
  Rejected: LLM-processed JSON conversions (text may be altered).
- **Dictionary retrieval by citation, not by search.** Entries are indexed by
  the `osisRef` of every Scripture reference they contain; the context agent
  sees entries that cite the passage plus entries for terms it asks for. This
  keeps the agent inside real text.
- **Language candidates from TAGNT.** The agent is shown the passage's Greek
  words with lemma, gloss and lexicon entry; it may pick at most one word.
  Code checks the Strong number is in the passage and the quote is in the
  lexicon entry.
- **Quote verification reuses the narrative editor's normalization** (case,
  punctuation, whitespace) as a verbatim-run test; near misses fail.
- **One orchestrator with a deps seam** mirroring `GenerateDevotionalDeps`, so
  tests fake each agent; agents export `_internal.JSON_SCHEMA` without
  min/max keywords (`anthropic-schema-compat.test.ts`).
- **Models:** writer, message and depth agents on the writer's model
  (`anthropic/claude-sonnet-4.5`); the new ending on the same model so the
  message is not handed across model families.

## Implementation Units

### U1. Reference corpora ingest and loader

**Goal:** Easton, Smith, TBESG and TAGNT (Luke) as JSON corpora with lookups.
**Files:** `apps/mastra/src/scripts/ingest-reference-corpora.ts`,
`apps/mastra/src/services/devotional/reference-corpus.ts`,
`apps/mastra/src/services/devotional/reference-corpus.test.ts`
**Approach:** ThML `<term>/<def>` to `{term, source, text, refs[]}` with
`scripRef osisRef`; TBESG lines to `{strong, lemma, translit, gloss, text}`
(HTML stripped); TAGNT rows to `{osis, pos, greek, translit, english, strong,
lemma}`. Loader: `entriesCiting(osisRange)`, `entry(term)`,
`greekWords(osisRange)`, `lexicon(strong)`, `verifyQuote(quote, text)`.
**Test scenarios:** an entry citing Luke 15:16 is returned for Luke 15:11-32
and not for Luke 16; Greek words for Luke 15:20 include G4697 with lemma
σπλαγχνίζομαι; `verifyQuote` passes an exact run with different spacing and
case, fails a one-word substitution.

### U2. Message agent

**Files:** `apps/mastra/src/services/devotional/devotional-message.ts`,
`apps/mastra/src/mastra/agents/devotional/message-agent.ts`, test.
**Test scenarios:** schema parse; empty idea rejected; message carried into the
writer's prompt (deps test).

### U3. Depth agents

**Files:** `apps/mastra/src/services/devotional/depth-context.ts`,
`apps/mastra/src/services/devotional/depth-language.ts`, agents, tests.
**Test scenarios:** unverifiable quote dropped; a Greek word not in the passage
dropped; `nothing-useful` yields no section; `conflict` stops the run with a
typed error naming the agent and its reason.

### U4. Message-first writer

**Files:** `apps/mastra/src/services/devotional/message-first-writer.ts`,
agent, test.
**Approach:** returns paragraphs `{text, role: classic|history|language|
application, sourceKey?}`; runs `checkReflectionVoice` and repairs like the
modernizer; builds `ReflectionParagraph` with voices (history/language on the
second voice, as in Vineyard) and one `SourceMark` per section start with
`evidence` = the verified quotes / classic excerpt.
**Test scenarios:** a history paragraph gets the book mark and evidence; the
classic section gets the commentary mark with life dates; dashes stripped.

### U5. Ending and A/B

**Files:** `apps/mastra/src/services/devotional/message-first-ending.ts`, test.
**Approach:** takeaway (message + reflection), then question + prayer (final
reflection + takeaway + askDirection). Baseline: `writeDevotionalCopy` on the
same reflection. Output an A/B sheet with the two pairs in random order.

### U6. Orchestrator + CLI + LUMO source

**Files:** `apps/mastra/src/services/devotional/compose-message-first.ts`,
`apps/mastra/src/scripts/compose-message-first.ts`,
`apps/mastra/src/services/devotional/video-sources.ts` (add `lumo-luke-15`),
test.
**Approach:** builds the chapter from the video source (the JESUS chapter
table has no LUMO rows), loads both Ryle Luke 15 sections, runs U2-U5 and the
existing highlighter + quality gate (message passed to the narrative editor),
saves the devotional to the cache, and writes a readable script plus the
message, depth notes and A/B sheet for the owner.

## Risks

- Depth agents padding with weak facts: mitigated by `nothing-useful` being a
  first-class answer and by showing the owner the notes beside the script.
- Dictionaries from 1863/1897 carry dated scholarship: facts must also be
  checked by the narrative editor against the quote, and the owner sees them.

## Verification

- Unit tests above pass; the whole devotional suite stays green.
- A real run on the Prodigal Son produces: message, depth notes with verified
  quotes, a script, and the A/B sheet; the quality gate passes or its findings
  are listed for the owner.
