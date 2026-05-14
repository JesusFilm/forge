import { describe, expect, it } from "vitest"

import {
  DRAFT_EXPERIENCE_PROMPT,
  ADD_SECTION_PROMPT,
  REWRITE_COPY_PROMPT,
  AUTO_ENRICH_PROMPT,
} from "./index"

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

  describe("registry index", () => {
    it("re-exports all four prompts", async () => {
      const {
        DRAFT_EXPERIENCE_PROMPT,
        ADD_SECTION_PROMPT,
        REWRITE_COPY_PROMPT,
        AUTO_ENRICH_PROMPT,
      } = await import("./index")
      expect(typeof DRAFT_EXPERIENCE_PROMPT).toBe("string")
      expect(typeof ADD_SECTION_PROMPT).toBe("string")
      expect(typeof REWRITE_COPY_PROMPT).toBe("string")
      expect(typeof AUTO_ENRICH_PROMPT).toBe("string")
    })
  })
})
