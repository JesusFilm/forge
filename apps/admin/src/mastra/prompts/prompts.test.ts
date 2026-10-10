import { describe, expect, it } from "vitest"

import {
  DRAFT_EXPERIENCE_PROMPT,
  ADD_SECTION_PROMPT,
  REWRITE_COPY_PROMPT,
  AUTO_ENRICH_PROMPT,
  PLAN_EXPERIENCE_PROMPT,
  CRITIQUE_EXPERIENCE_PROMPT,
  REVISE_EXPERIENCE_PROMPT,
} from "./index"
import type { PromptId } from "./index"

/**
 * Asserts the parallel branch's load-bearing rule strings carry into
 * the Mastra prompt registry. These constraints come from the
 * existing `experience-ai-chat-prompts.test.ts` on
 * `feat/admin-chat-multi-channel-providers` — keeping them green here
 * ensures the rebase doesn't silently drop a rule the editor and
 * canvas relied on.
 */

describe("prompts registry", () => {
  describe("DRAFT_EXPERIENCE_PROMPT", () => {
    it("requires a full inline draft on empty canvas (no brief-flow defer)", () => {
      expect(DRAFT_EXPERIENCE_PROMPT).toContain("FULL DRAFT")
      expect(DRAFT_EXPERIENCE_PROMPT).toContain("do NOT defer to a brief flow")
      expect(DRAFT_EXPERIENCE_PROMPT).toContain('complete "blocks" array')
    })

    it("tells the agent to use candidate videoIds verbatim from tool results", () => {
      expect(DRAFT_EXPERIENCE_PROMPT).toContain(
        'Use candidate "videoId" values in block "videoId" fields',
      )
      expect(DRAFT_EXPERIENCE_PROMPT).toContain("never invent video ids")
    })

    it("constrains section.content to the allowed three block types", () => {
      expect(DRAFT_EXPERIENCE_PROMPT).toContain(
        'Inside section.content valid types are: "mediaCollection" | "text" | "promoBanner"',
      )
    })

    it('requires the admin block discriminator field "t"', () => {
      expect(DRAFT_EXPERIENCE_PROMPT).toContain('discriminator field "t"')
      expect(DRAFT_EXPERIENCE_PROMPT).toContain('NEVER use "type"')
    })

    it("spells out scalar diff objects instead of value shorthands", () => {
      expect(DRAFT_EXPERIENCE_PROMPT).toContain(
        'use { "before": <current value>, "after": <new value> }',
      )
      expect(DRAFT_EXPERIENCE_PROMPT).toContain('Do not use { "value": ... }')
    })

    it("provides common valid block shapes and forbids invented fields", () => {
      expect(DRAFT_EXPERIENCE_PROMPT).toContain("Common valid shapes")
      expect(DRAFT_EXPERIENCE_PROMPT).toContain(
        'Do NOT put "heading" directly on section',
      )
      expect(DRAFT_EXPERIENCE_PROMPT).toContain(
        'Use "reference", NOT "verseReference"',
      )
      expect(DRAFT_EXPERIENCE_PROMPT).toContain(
        'Do not invent fields such as "caption"',
      )
    })

    it("forbids the rejected `label` field on mediaCollection items", () => {
      expect(DRAFT_EXPERIENCE_PROMPT).toContain(
        'DO NOT use "label" on mediaCollection items',
      )
      expect(DRAFT_EXPERIENCE_PROMPT).toContain('"titleOverride"')
      expect(DRAFT_EXPERIENCE_PROMPT).toContain('"labelOverride"')
    })

    it('uses "heading" not "title" guidance', () => {
      expect(DRAFT_EXPERIENCE_PROMPT).toContain('Use "heading"')
    })

    it("includes the planner-outline input-section preamble", () => {
      expect(DRAFT_EXPERIENCE_PROMPT).toContain(
        "You will receive a planning outline. Use it as context for narrative arc and video themes, but the editor's prompt is authoritative for the final content.",
      )
    })

    it("preserves the JSON-rule section byte-stable across the planner-outline preamble addition", () => {
      // The block of rules that defines the structured-envelope contract
      // must not drift when the planner-outline preamble lands. Assert
      // byte-equality of the contiguous JSON-rule section (envelope
      // shape through Rule 6, SCALAR DIFF SHAPE) against the expected
      // literal. Editing any of these characters fails this test
      // deliberately — reshaping the JSON contract is a separate,
      // observable change.
      const jsonRuleSectionStart = DRAFT_EXPERIENCE_PROMPT.indexOf(
        "Your output must be a structured envelope:",
      )
      const jsonRuleSectionEnd = DRAFT_EXPERIENCE_PROMPT.indexOf(
        "Return the structured envelope ONLY.",
      )
      expect(jsonRuleSectionStart).toBeGreaterThan(-1)
      expect(jsonRuleSectionEnd).toBeGreaterThan(jsonRuleSectionStart)
      const jsonRuleSection = DRAFT_EXPERIENCE_PROMPT.slice(
        jsonRuleSectionStart,
        jsonRuleSectionEnd,
      )
      const expectedJsonRuleSection = `Your output must be a structured envelope:

  { "diff": { "scalars": { "title": { "before": "", "after": "..." }, "metaDescription": { "before": null, "after": "..." } }, "blocks": [ ...top-level blocks... ] } }

Rules:

1. EMPTY CANVAS → FULL DRAFT. When the editor's current canvas has no blocks AND the prompt asks to create, draft, generate, build, or start an experience, propose a FULL initial draft inline. Set "title", "metaDescription", AND a complete "blocks" array (typically 4-8 blocks: a videoHero or text intro, 1-3 content sections, and a cta near the end). Use whatever topic / audience / tone / Scripture / CTA cues the editor included in the prompt — do NOT defer to a brief flow.

2. TOOLS FIRST. When you need a video, a Bible reference, or a video image, call the appropriate tool instead of asking the editor for it. Available tools: searchVideos, lookupBibleVerse, fetchVideoImage. Use candidate "videoId" values in block "videoId" fields verbatim — never invent video ids.

3. STRICT BLOCK SCHEMA. Every block MUST use the discriminator field "t" (for example { "t": "videoHero" }); NEVER use "type". Top-level block types include videoHero, mediaCollection, section, container, card, cta, navigationCarousel, videoCarousel, promoBanner, bibleQuotesCarousel, relatedQuestions. Inside section.content valid types are: "mediaCollection" | "text" | "promoBanner". Text copy belongs in "contentParagraphs" arrays, not a "text" field. CTAs use "buttonLabel" (only quizButton uses "buttonText"). Use "heading", NOT "title", on most blocks. Use "titleOverride" / "labelOverride" on mediaCollection items, NOT "label". DO NOT use "label" on mediaCollection items.

   Common valid shapes:
   - videoHero: { "t": "videoHero", "sectionKey": "s01", "videoId": "...", "heading": "...", "subheading": "...", "ctaEnabled": true, "ctaLabel": "Watch now" }
   - section: { "t": "section", "sectionKey": "s02", "content": [ ...section child blocks... ] }. Do NOT put "heading" directly on section; wrap heading/copy in a child text block.
   - text: { "t": "text", "heading": "...", "contentParagraphs": ["..."] }
   - bibleQuotesCarousel: { "t": "bibleQuotesCarousel", "heading": "...", "quotes": [{ "reference": "John 20:19-29", "text": "..." }] }. Use "reference", NOT "verseReference".
   - cta: { "t": "cta", "heading": "...", "body": "...", "buttonLabel": "Watch Video" }
   Unknown fields are invalid. Do not invent fields such as "caption", "text", "verseReference", or "buttonText" on non-quizButton blocks.

4. PRESERVE EDITOR INTENT. The editor's prompt is the source of truth for topic, tone, and CTA. Honor explicit cues. If a Scripture passage is mentioned, include it via bibleQuotesCarousel or text blocks. If the editor names a target audience, write copy for them, not generically.

5. CONTENT CONSTRAINTS. Each top-level block must satisfy its schema. Section blocks must not contain another section. quizButton is only valid inside section.content. Use contentId references like "s02" for navigationCarousel entries.

6. SCALAR DIFF SHAPE. When setting title or metaDescription, use { "before": <current value>, "after": <new value> }. Do not use { "value": ... } and do not put scalar strings directly under "diff.scalars".

`
      expect(jsonRuleSection).toBe(expectedJsonRuleSection)
    })
  })

  describe("ADD_SECTION_PROMPT", () => {
    it("preserves every existing top-level block", () => {
      expect(ADD_SECTION_PROMPT).toContain(
        "preserve every existing top-level block",
      )
    })

    it("returns the complete existing blocks array plus exactly one new block", () => {
      expect(ADD_SECTION_PROMPT).toContain(
        'Return "diff.blocks" as the complete existing blocks array plus exactly the requested new top-level block',
      )
    })

    it("forbids reordering, renaming, replacing, or rewriting existing blocks", () => {
      expect(ADD_SECTION_PROMPT).toContain(
        "Do not rename, reorder, replace, or rewrite",
      )
    })

    it("keeps bundled rewrite or scalar asks out of the add-section agent", () => {
      expect(ADD_SECTION_PROMPT).toContain("ADD-ONLY SCOPE")
      expect(ADD_SECTION_PROMPT).toContain("ignore those extra asks")
      expect(ADD_SECTION_PROMPT).toContain('Always leave "diff.scalars" as {}')
    })
  })

  describe("REWRITE_COPY_PROMPT", () => {
    it("forbids adding or removing blocks", () => {
      expect(REWRITE_COPY_PROMPT).toContain("Never add or remove blocks")
    })

    it("forbids changing block type or reference fields", () => {
      expect(REWRITE_COPY_PROMPT).toContain('Never change a block\'s "t" type')
      expect(REWRITE_COPY_PROMPT).toContain(
        'Never modify "videoId", "imageUrl", "contentId"',
      )
    })

    it("explicitly says no tools", () => {
      expect(REWRITE_COPY_PROMPT).toContain("NO TOOLS")
    })
  })

  describe("AUTO_ENRICH_PROMPT", () => {
    it("only fills missing references and preserves the rest", () => {
      expect(AUTO_ENRICH_PROMPT).toContain("ONLY FILL MISSING")
      expect(AUTO_ENRICH_PROMPT).toContain("PRESERVE EVERYTHING ELSE")
    })

    it("forbids copy edits during enrichment", () => {
      expect(AUTO_ENRICH_PROMPT).toContain("NO COPY EDITS")
    })

    it("instructs the agent to skip blocks it can't resolve (per-block error isolation)", () => {
      expect(AUTO_ENRICH_PROMPT).toContain("SKIP WHAT YOU CANNOT RESOLVE")
      expect(AUTO_ENRICH_PROMPT).toContain("Per-block error isolation")
    })
  })

  describe("PLAN_EXPERIENCE_PROMPT", () => {
    it("is a non-empty string", () => {
      expect(typeof PLAN_EXPERIENCE_PROMPT).toBe("string")
      expect(PLAN_EXPERIENCE_PROMPT.length).toBeGreaterThan(0)
    })

    it("instructs the planner to emit plain text, not JSON", () => {
      expect(PLAN_EXPERIENCE_PROMPT).toContain("PLAIN TEXT ONLY")
      expect(PLAN_EXPERIENCE_PROMPT).toContain("No JSON")
    })

    it("calls out target / hook / arc / video themes as the four things the outline must cover", () => {
      expect(PLAN_EXPERIENCE_PROMPT).toContain("target audience")
      expect(PLAN_EXPERIENCE_PROMPT).toContain("hook")
      expect(PLAN_EXPERIENCE_PROMPT).toContain("narrative arc")
      expect(PLAN_EXPERIENCE_PROMPT).toContain("video themes")
    })

    it("forbids the planner from proposing block schema or video ids", () => {
      expect(PLAN_EXPERIENCE_PROMPT).toContain("NO BLOCK SCHEMA")
      expect(PLAN_EXPERIENCE_PROMPT).toContain("do not propose videoIds")
    })
  })

  describe("CRITIQUE_EXPERIENCE_PROMPT", () => {
    it("is a non-empty string", () => {
      expect(typeof CRITIQUE_EXPERIENCE_PROMPT).toBe("string")
      expect(CRITIQUE_EXPERIENCE_PROMPT.length).toBeGreaterThan(0)
    })

    it("instructs the critic to read the draft as JSON and emit plain-text bullets", () => {
      expect(CRITIQUE_EXPERIENCE_PROMPT).toContain(
        "JSON envelope ({ title, metaDescription, blocks })",
      )
      expect(CRITIQUE_EXPERIENCE_PROMPT).toContain("PLAIN TEXT BULLETS")
    })

    it("names the four evaluation criteria", () => {
      expect(CRITIQUE_EXPERIENCE_PROMPT).toContain("SPECIFICITY")
      expect(CRITIQUE_EXPERIENCE_PROMPT).toContain("SCRIPTURE GROUNDING")
      expect(CRITIQUE_EXPERIENCE_PROMPT).toContain("VIDEO RELEVANCE")
      expect(CRITIQUE_EXPERIENCE_PROMPT).toContain("BLOCK COHERENCE")
    })

    it("forbids the critic from drafting replacement copy", () => {
      expect(CRITIQUE_EXPERIENCE_PROMPT).toContain("NO REWRITES")
    })
  })

  describe("REVISE_EXPERIENCE_PROMPT", () => {
    it("is a non-empty string", () => {
      expect(typeof REVISE_EXPERIENCE_PROMPT).toBe("string")
      expect(REVISE_EXPERIENCE_PROMPT.length).toBeGreaterThan(0)
    })

    it("repeats the JSON-shape rules from the draft contract", () => {
      // The reviser must emit the SAME DraftExperienceSchema shape as
      // the draft step. Assert the key contract strings are present so
      // the two prompts stay in sync.
      expect(REVISE_EXPERIENCE_PROMPT).toContain("structured envelope")
      expect(REVISE_EXPERIENCE_PROMPT).toContain('discriminator field "t"')
      expect(REVISE_EXPERIENCE_PROMPT).toContain('NEVER use "type"')
      expect(REVISE_EXPERIENCE_PROMPT).toContain(
        'use { "before": <current value>, "after": <new value> }',
      )
      expect(REVISE_EXPERIENCE_PROMPT).toContain(
        'Use "reference", NOT "verseReference"',
      )
    })

    it("instructs the reviser to apply critique notes while preserving working blocks", () => {
      expect(REVISE_EXPERIENCE_PROMPT).toContain("APPLY THE NOTES")
      expect(REVISE_EXPERIENCE_PROMPT).toContain("PRESERVE WHAT WAS WORKING")
    })

    it("tells the reviser to use tools verbatim and never invent video ids", () => {
      expect(REVISE_EXPERIENCE_PROMPT).toContain("never invent video ids")
    })
  })

  describe("registry index", () => {
    it("re-exports all seven prompts", async () => {
      const {
        DRAFT_EXPERIENCE_PROMPT,
        ADD_SECTION_PROMPT,
        REWRITE_COPY_PROMPT,
        AUTO_ENRICH_PROMPT,
        PLAN_EXPERIENCE_PROMPT,
        CRITIQUE_EXPERIENCE_PROMPT,
        REVISE_EXPERIENCE_PROMPT,
      } = await import("./index")
      expect(typeof DRAFT_EXPERIENCE_PROMPT).toBe("string")
      expect(typeof ADD_SECTION_PROMPT).toBe("string")
      expect(typeof REWRITE_COPY_PROMPT).toBe("string")
      expect(typeof AUTO_ENRICH_PROMPT).toBe("string")
      expect(typeof PLAN_EXPERIENCE_PROMPT).toBe("string")
      expect(typeof CRITIQUE_EXPERIENCE_PROMPT).toBe("string")
      expect(typeof REVISE_EXPERIENCE_PROMPT).toBe("string")
    })

    it("extends the PromptId literal union with the three new workflow-step ids", () => {
      // Compile-time check: every new id must be assignable to PromptId.
      // Each binding will fail TypeScript narrowing if the union ever
      // loses one of these literals, which is the regression we want
      // this test to catch.
      const planId: PromptId = "plan-experience"
      const critiqueId: PromptId = "critique-experience"
      const reviseId: PromptId = "revise-experience"
      expect(planId).toBe("plan-experience")
      expect(critiqueId).toBe("critique-experience")
      expect(reviseId).toBe("revise-experience")
    })
  })
})
