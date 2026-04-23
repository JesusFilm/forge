import { describe, expect, it } from "vitest"
import {
  buildSharedAgentPrompt,
  getSharedAgentDefinition,
  listSharedAgentDefinitions,
  validateSharedAgentRunInput,
} from "./catalog"

describe("@forge/agents catalog", () => {
  it("exports the starter shared agents", () => {
    const definitions = listSharedAgentDefinitions()

    expect(definitions.map((definition) => definition.id)).toEqual([
      "translation",
      "video_enhancing",
      "seo",
      "marketing",
    ])
    expect(
      definitions.every(
        (definition) => definition.capabilities.supportsSessions,
      ),
    ).toBe(true)
    expect(
      definitions
        .filter((definition) => definition.capabilities.supportsWriteback)
        .map((definition) => definition.id),
    ).toEqual(["translation", "seo"])
  })

  it("resolves starter agent definitions by id", () => {
    expect(getSharedAgentDefinition("seo")?.name).toBe("SEO Agent")
    expect(getSharedAgentDefinition("missing")).toBeNull()
  })

  it("requires translation inputs specific to the chosen agent", () => {
    const translation = getSharedAgentDefinition("translation")
    expect(translation).not.toBeNull()

    const result = validateSharedAgentRunInput(translation!, {
      goal: "Translate this for launch",
      fields: {
        source_text: "Hello world",
      },
    })

    expect(result).toEqual({
      success: false,
      errors: ["Target language is required."],
    })
  })

  it("rejects undeclared fields", () => {
    const marketing = getSharedAgentDefinition("marketing")
    expect(marketing).not.toBeNull()

    const result = validateSharedAgentRunInput(marketing!, {
      goal: "Write launch copy",
      fields: {
        offer_or_content: "New app release",
        audience: "Church staff",
        random_field: "nope",
      },
    })

    expect(result).toEqual({
      success: false,
      errors: ["Unknown field(s): random_field"],
    })
  })

  it("builds user prompts from shared context and declared fields", () => {
    const seo = getSharedAgentDefinition("seo")
    expect(seo).not.toBeNull()

    const prompt = buildSharedAgentPrompt(seo!, {
      goal: "Improve discovery",
      supportingContext: "This should rank for Easter outreach queries.",
      fields: {
        source_copy: "Current article draft",
        target_keyword: "easter outreach ideas",
      },
    })

    expect(prompt).toContain("Goal:\nImprove discovery")
    expect(prompt).toContain(
      "Supporting context:\nThis should rank for Easter outreach queries.",
    )
    expect(prompt).toContain("Source copy:\nCurrent article draft")
    expect(prompt).toContain("Target keyword:\neaster outreach ideas")
  })
})
