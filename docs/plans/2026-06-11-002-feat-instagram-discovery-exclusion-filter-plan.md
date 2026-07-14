---
title: "feat: Instagram discovery commentary exclusion filter"
type: feat
status: active
created: 2026-06-11
depth: lightweight
---

# feat: Instagram Discovery Commentary Exclusion Filter

## Problem & Context

The deployed `instagram-ai-christian-discovery` workflow (`apps/mastra`) keeps a
post when its caption contains any AI keyword AND any Christian keyword. Live
runs show this surfaces a lot of **commentary about** AI Christian content
(news, reactions, "here's my Veo 3 prompt" tutorials, bloggers discussing AI
music) rather than actual AI-made Christian video creations.

This change adds a cheap, deterministic **commentary exclusion filter**: a post
that otherwise qualifies is dropped if its caption reads as
commentary/news/tutorial. It is the first, smallest precision improvement; the
heavier LLM-based relevance check is deliberately deferred to a separate effort.

## Requirements

- R1. A post that matches AI + Christian keywords is still dropped if its caption
  signals commentary/news/tutorial/reaction.
- R2. The keyword list is conservative — it must not drop genuine creations
  (e.g. "I recreated ... using AI storytelling").
- R3. The run report exposes how many posts were excluded as commentary, so the
  operator can see the filter working.

Success criteria: on a realistic run, "blogger talking about AI music" and
"here's my ChatGPT prompt" style posts are removed, while genuine creations are
kept; the report shows an `excludedCommentary` count.

## Key Technical Decisions

- Filter lives in the existing classifier (`classifier.ts`) as a
  `COMMENTARY_KEYWORDS` list folded into `qualifies()`. No new service, no LLM,
  no new env var. Reuses the existing word-boundary keyword matcher.
- Conservative word list: only phrases that strongly indicate talking-about
  (not making). Do not exclude on generic words like "AI" or "video".
- Surface an `excludedCommentary` count in the report totals so the effect is
  observable (mirrors the existing `candidates/instagram/deduped/qualified`).

## Patterns To Follow

- Keyword lists + pure matcher + `qualifies()`: `apps/mastra/src/services/instagram-discovery/classifier.ts`.
- Totals schema + types: `apps/mastra/src/services/instagram-discovery/artifacts.ts` (`DiscoveryTotalsSchema`), `types.ts` (`DiscoveryTotals`).
- Funnel computation: `selectQualifyingPosts` in `apps/mastra/src/mastra/workflows/instagram-ai-christian-discovery.ts`.

## Implementation Units

### U1. Commentary exclusion in the classifier

**Goal:** Drop otherwise-qualifying posts that read as commentary.
**Requirements:** R1, R2.
**Files:** `apps/mastra/src/services/instagram-discovery/classifier.ts`, `apps/mastra/src/services/instagram-discovery/classifier.test.ts`, `apps/mastra/src/services/instagram-discovery/types.ts`.
**Approach:** Add `COMMENTARY_KEYWORDS`; `classifyPost` returns `isCommentary` + `matchedCommentary`; `qualifies()` becomes `isAiGenerated && isChristian && !isCommentary`. Extend `MatchSignals`.
**Test scenarios:**

- "Should we be listening to AI generated Christian music?" → excluded.
- "Here's my EXACT ChatGPT conversation to make these Veo 3 Bible prompts" → excluded.
- "I recreated Jesus' crucifixion using cinematic AI storytelling" → kept.
- No commentary words → unaffected; empty caption → nothing flagged.

### U2. Surface the excludedCommentary count + docs

**Goal:** Make the filter's effect observable; document it.
**Requirements:** R3.
**Dependencies:** U1.
**Files:** `apps/mastra/src/services/instagram-discovery/types.ts`, `apps/mastra/src/services/instagram-discovery/artifacts.ts`, `apps/mastra/src/mastra/workflows/instagram-ai-christian-discovery.ts`, `apps/mastra/src/mastra/workflows/instagram-ai-christian-discovery.test.ts`, `apps/mastra/CLAUDE.md`.
**Approach:** Add `excludedCommentary` to `DiscoveryTotals` + `DiscoveryTotalsSchema`. In `selectQualifyingPosts`, count deduped posts whose signals are AI+Christian but commentary-excluded. Update the CLAUDE.md discovery section to mention the exclusion filter.
**Test scenarios:**

- `runInstagramDiscovery` over a mix incl. a commentary post → that post absent from `posts`, `totals.excludedCommentary >= 1`, genuine creation kept.
- Artifact schema round-trips with the new total field.

## Scope Boundaries

### In scope

- Commentary keyword exclusion + observable count + docs note.

### Deferred to Follow-Up Work

- LLM relevance check (separate plan: `2026-06-11-001-...-relevance-filter-plan.md`).
- Trusted-accounts follow-list; cross-run memory; website approval queue.

### Non-goals

- Watching the video; auto-publishing.

## Verification

- `pnpm --filter @forge/mastra test`, `typecheck`, `lint` clean.
- Local: run `runInstagramDiscovery` over the real "blogger talking about AI music"
  sample captions; confirm they are excluded and the count reflects it.
