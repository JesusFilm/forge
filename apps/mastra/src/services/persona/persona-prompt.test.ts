import { describe, expect, it } from "vitest"

import { loadPersona } from "./persona-library"
import {
  buildPersonaTopicPrompt,
  renderPersonaPromptBlock,
} from "./persona-prompt"

describe("persona-prompt", () => {
  it("renders the persona's steering fields into the block", () => {
    const persona = loadPersona("grieving")
    expect(persona).toBeDefined()
    const block = renderPersonaPromptBlock(persona!)
    expect(block).toContain(persona!.name)
    expect(block).toContain(persona!.tone)
    expect(block).toContain(persona!.scripturePosture)
    expect(block).toContain(persona!.emotionalGoal)
    for (const need of persona!.needs) expect(block).toContain(need)
  })

  it("composes topic + persona with persona steering before the topic", () => {
    const persona = loadPersona("family")!
    const prompt = buildPersonaTopicPrompt("Easter", persona)
    expect(prompt).toContain("Easter")
    expect(prompt).toContain(persona.name)
    expect(prompt.indexOf(persona.name)).toBeLessThan(prompt.indexOf("Easter"))
  })

  it("two personas over the same topic yield different prompts (divergence seam)", () => {
    const grieving = buildPersonaTopicPrompt("Easter", loadPersona("grieving")!)
    const skeptic = buildPersonaTopicPrompt(
      "Easter",
      loadPersona("seeker-skeptic")!,
    )
    expect(grieving).not.toEqual(skeptic)
  })
})
