import { afterEach, describe, expect, it, vi } from "vitest"

import {
  OpenAICompatibleLanguageDetector,
  OpenAICompatibleLlmReviewer,
  parseDetection,
} from "./openai-compatible-language.js"

afterEach(() => vi.unstubAllGlobals())

describe("OpenAI-compatible language adapters", () => {
  it("parses strict ISO language verdicts and honestly abstains otherwise", () => {
    expect(
      parseDetection('{"language":"FR","confidence":0.9,"evidence":"bonjour"}'),
    ).toEqual({
      language: "fr",
      confidence: 0.9,
      evidence: "bonjour",
    })
    expect(
      parseDetection('{"language":"eng","confidence":0.9,"evidence":"hello"}'),
    ).toMatchObject({
      language: null,
      confidence: 0,
    })
  })

  it("detects via JSON chat completions and skips blank input", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '{"language":"es","confidence":1,"evidence":"hola"}',
                },
              },
            ],
          }),
          { status: 200 },
        ),
    )
    vi.stubGlobal("fetch", fetchMock)
    const detector = new OpenAICompatibleLanguageDetector({
      apiKey: "key",
      model: "model",
    })
    await expect(
      detector.detect("hola mundo", { declared: ["en"] }),
    ).resolves.toMatchObject({ language: "es" })
    await detector.detect(" ", { declared: ["en"] })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(detector.model).toBe("model")
  })

  it("returns a reviewer's free-form completion", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: " looks sound " } }],
            }),
            { status: 200 },
          ),
      ),
    )
    await expect(
      new OpenAICompatibleLlmReviewer({ apiKey: "key", model: "model" }).review(
        "audit",
        "changes",
      ),
    ).resolves.toBe("looks sound")
  })
})
