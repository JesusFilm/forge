import { describe, expect, it } from "vitest"

import { DevotionalLlmError, type DevotionalLlm } from "./llm"
import {
  selectScripture,
  ScriptureSelectorError,
  _internal,
} from "./scripture-selector"
import type { Hook } from "./types"

const HOOK: Hook = {
  type: "question",
  title: "Where do you turn when you are afraid?",
  summary: "An invitation to bring fear to God.",
  sourceUrl: null,
}
const SYSTEM_PROMPT = "Choose one short Bible passage and return JSON."

function llmReturning(value: unknown): DevotionalLlm {
  return { model: "test-model", complete: async () => value as never }
}

function llmThrowing(error: unknown): DevotionalLlm {
  return {
    model: "test-model",
    complete: async () => {
      throw error
    },
  }
}

describe("selectScripture", () => {
  it("returns a reference and passage for a given hook", async () => {
    const scripture = await selectScripture({
      hook: HOOK,
      llm: llmReturning({
        reference: "Psalm 56:3",
        text: "When I am afraid, I put my trust in you.",
        translation: "NIV",
      }),
      systemPrompt: SYSTEM_PROMPT,
    })

    expect(scripture.reference).toBe("Psalm 56:3")
    expect(scripture.text).toContain("afraid")
    expect(scripture.translation).toBe("NIV")
  })

  it("always carries the needs-canonical-source flag (A5)", async () => {
    const scripture = await selectScripture({
      hook: HOOK,
      llm: llmReturning({
        reference: "John 14:27",
        text: "Peace I leave with you.",
      }),
      systemPrompt: SYSTEM_PROMPT,
    })

    expect(scripture.needsCanonicalSource).toBe(true)
    // translation omitted by the model normalizes to null.
    expect(scripture.translation).toBeNull()
  })

  it("normalizes and accepts multi-word and numbered references", async () => {
    const scripture = await selectScripture({
      hook: HOOK,
      llm: llmReturning({
        reference: "  1 John 4:18.  ",
        text: "There is no fear in love.",
      }),
      systemPrompt: SYSTEM_PROMPT,
    })

    expect(scripture.reference).toBe("1 John 4:18")
  })

  it("rejects a malformed reference with invalid_reference", async () => {
    await expect(
      selectScripture({
        hook: HOOK,
        llm: llmReturning({
          reference: "a comforting verse about fear",
          text: "Do not be afraid.",
        }),
        systemPrompt: SYSTEM_PROMPT,
      }),
    ).rejects.toMatchObject({
      name: "ScriptureSelectorError",
      code: "invalid_reference",
    })
  })

  it("surfaces an LLM failure as a typed generation_failed error", async () => {
    await expect(
      selectScripture({
        hook: HOOK,
        llm: llmThrowing(new DevotionalLlmError("request_failed", "boom")),
        systemPrompt: SYSTEM_PROMPT,
      }),
    ).rejects.toBeInstanceOf(ScriptureSelectorError)
  })

  it("validates reference shapes correctly", () => {
    expect(_internal.isWellFormedReference("John 3:16")).toBe(true)
    expect(_internal.isWellFormedReference("Psalm 23")).toBe(true)
    expect(_internal.isWellFormedReference("Song of Solomon 2:1")).toBe(true)
    expect(_internal.isWellFormedReference("not a reference")).toBe(false)
    expect(_internal.isWellFormedReference("")).toBe(false)
  })
})
