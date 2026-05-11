import { beforeEach, describe, expect, it, vi } from "vitest"

const { envState } = vi.hoisted(() => ({
  envState: {
    OPENROUTER_API_KEY: "test-key" as string | undefined,
    OPENROUTER_EXPERIENCE_CHAT_MODEL: undefined as string | undefined,
    OPENROUTER_EXPERIENCE_CHAT_MODELS: undefined as string | undefined,
  },
}))

vi.mock("@/config/env", () => ({ env: envState }))

import {
  generateOpenRouterFreeStructuredOutput,
  openRouterExperienceChatModels,
} from "./experience-ai-openrouter-free"

function okResponse(payload: unknown, usedModel = "model-a") {
  return new Response(
    JSON.stringify({
      model: usedModel,
      choices: [
        {
          finish_reason: "stop",
          message: { content: JSON.stringify(payload) },
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  )
}

describe("OpenRouter free provider helper", () => {
  beforeEach(() => {
    envState.OPENROUTER_API_KEY = "test-key"
    envState.OPENROUTER_EXPERIENCE_CHAT_MODEL = undefined
    envState.OPENROUTER_EXPERIENCE_CHAT_MODELS = undefined
  })

  it("uses plural env models before singular and normalizes entries", () => {
    envState.OPENROUTER_EXPERIENCE_CHAT_MODEL = "single/free"
    envState.OPENROUTER_EXPERIENCE_CHAT_MODELS =
      " first/free , 'second/free' ,, "

    expect(openRouterExperienceChatModels()).toEqual([
      "first/free",
      "second/free",
    ])
  })

  it("returns validated payload and records the selected router model", async () => {
    envState.OPENROUTER_EXPERIENCE_CHAT_MODELS = "openrouter/free"
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({ ok: true }, "x/y"))

    const result = await generateOpenRouterFreeStructuredOutput({
      messages: [{ role: "user", content: "hi" }],
      responseFormat: { type: "json_object" },
      fetchImpl,
      validate: (payload) => payload as { ok: boolean },
    })

    expect(result.payload).toEqual({ ok: true })
    expect(result.model).toBe("openrouter/free")
    expect(result.usedModel).toBe("x/y")
    expect(result.attempts).toEqual([
      { model: "openrouter/free", usedModel: "x/y", status: "succeeded" },
    ])
  })

  it("tries the next model on 429 and succeeds", async () => {
    envState.OPENROUTER_EXPERIENCE_CHAT_MODELS = "model-a,model-b"
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate-limited", { status: 429 }))
      .mockResolvedValueOnce(okResponse({ ok: true }, "model-b"))

    const result = await generateOpenRouterFreeStructuredOutput({
      messages: [{ role: "user", content: "hi" }],
      responseFormat: { type: "json_object" },
      fetchImpl,
      validate: (payload) => payload as { ok: boolean },
    })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result.attempts[0]).toMatchObject({
      model: "model-a",
      status: "failed",
    })
    expect(result.usedModel).toBe("model-b")
  })

  it("tries the next model when validation fails", async () => {
    envState.OPENROUTER_EXPERIENCE_CHAT_MODELS = "model-a,model-b"
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okResponse({ ok: false }, "model-a"))
      .mockResolvedValueOnce(okResponse({ ok: true }, "model-b"))

    const result = await generateOpenRouterFreeStructuredOutput({
      messages: [{ role: "user", content: "hi" }],
      responseFormat: { type: "json_object" },
      fetchImpl,
      validate: (payload) => {
        if ((payload as { ok?: boolean }).ok !== true) {
          throw new Error("not ok")
        }
        return payload as { ok: boolean }
      },
    })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result.payload).toEqual({ ok: true })
  })

  it("throws a typed missing-provider error without an API key", async () => {
    envState.OPENROUTER_API_KEY = undefined

    await expect(
      generateOpenRouterFreeStructuredOutput({
        messages: [{ role: "user", content: "hi" }],
        responseFormat: { type: "json_object" },
        fetchImpl: vi.fn(),
        validate: (payload) => payload,
      }),
    ).rejects.toMatchObject({
      name: "OpenRouterFreeProviderError",
      code: "missing_provider",
    })
  })

  it("classifies all-rate-limited failures", async () => {
    envState.OPENROUTER_EXPERIENCE_CHAT_MODELS = "model-a,model-b"
    const fetchImpl = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response("rate-limited", { status: 429 })),
      )

    await expect(
      generateOpenRouterFreeStructuredOutput({
        messages: [{ role: "user", content: "hi" }],
        responseFormat: { type: "json_object" },
        fetchImpl,
        validate: (payload) => payload,
      }),
    ).rejects.toMatchObject({
      name: "OpenRouterFreeProviderError",
      code: "provider_rate_limited",
    })
  })
})
