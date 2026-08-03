import { describe, expect, it } from "vitest"

import {
  EXPECTED_PROMPT_SHA256,
  LINE_SECTIONS,
  linesForSection,
  PROMPT_SECTION_IDS,
  PROMPT_UNDER_TEST,
  promptLines,
  promptSha256,
  SECTION_MAPPING_VERSION,
  sectionForLine,
} from "./prompt-sections"
import { SEEKER_SYSTEM_PROMPT_FALLBACK } from "../../mastra/agents/seeker-agent"

describe("prompt-sections drift guard", () => {
  it("fails with a pointer to the mapping whenever the prompt changes without a mapping update", () => {
    expect(
      promptSha256(),
      [
        "The seeker system prompt changed but the eval's line→section mapping",
        "was not updated. Fix: re-verify EVERY line assignment in",
        "apps/mastra/src/evals/seeker/prompt-sections.ts (LINE_SECTIONS),",
        "update EXPECTED_PROMPT_SHA256 to the new hash, and bump",
        `SECTION_MAPPING_VERSION (currently ${SECTION_MAPPING_VERSION}).`,
      ].join(" "),
    ).toBe(EXPECTED_PROMPT_SHA256)
  })

  it("sources the prompt from the agent's exported fallback, never a copy", () => {
    expect(PROMPT_UNDER_TEST).toBe(SEEKER_SYSTEM_PROMPT_FALLBACK)
  })

  it("maps every prompt line exactly once, in order", () => {
    const lines = promptLines()
    expect(LINE_SECTIONS).toHaveLength(lines.length)
    LINE_SECTIONS.forEach((entry, index) => {
      expect(entry.line).toBe(index)
    })
  })

  it("pins each mapping entry to the words of the line it claims", () => {
    const lines = promptLines()
    for (const entry of LINE_SECTIONS) {
      expect(
        lines[entry.line].startsWith(entry.lineStart),
        `LINE_SECTIONS entry for line ${entry.line} claims a line starting ` +
          `"${entry.lineStart}" but the prompt line is "${lines[entry.line].slice(0, 60)}..." — `,
      ).toBe(true)
    }
  })

  it("uses only known section ids", () => {
    for (const entry of LINE_SECTIONS) {
      expect(PROMPT_SECTION_IDS).toContain(entry.section)
    }
  })

  it("resolves lines to sections and sections to lines consistently", () => {
    expect(sectionForLine(0)).toBe("persona")
    expect(sectionForLine(12)).toBe("safety")
    expect(() => sectionForLine(99)).toThrow(/no section mapping/)
    for (const line of linesForSection("citation-discipline")) {
      expect(sectionForLine(line)).toBe("citation-discipline")
    }
    // `unowned` is a pseudo-section for behaviours no prompt line owns.
    expect(linesForSection("unowned")).toHaveLength(0)
  })
})
