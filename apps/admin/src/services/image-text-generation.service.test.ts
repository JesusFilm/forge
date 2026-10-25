import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("generateLocalizedImageText", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
    delete process.env.OPENROUTER_API_KEY
    delete process.env.OPENROUTER_IMAGE_TEXT_MODELS
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_BASE_URL
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.OPENROUTER_API_KEY
    delete process.env.OPENROUTER_IMAGE_TEXT_MODEL
    delete process.env.OPENROUTER_IMAGE_TEXT_MODELS
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_BASE_URL
  })

  it("returns skipped when no OpenRouter provider is configured", async () => {
    const { generateLocalizedImageText } =
      await import("./image-text-generation.service")

    await expect(
      generateLocalizedImageText({
        imageDataUrl: "data:image/png;base64,abc",
        sourceName: "hero.png",
        locales: ["en"],
      }),
    ).resolves.toEqual({ status: "skipped", reason: "missing_provider" })
  })

  it("calls OpenRouter chat completions and validates localized output", async () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key"
    process.env.OPENROUTER_IMAGE_TEXT_MODEL = "openrouter/free"
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: JSON.stringify({
                  locales: [
                    {
                      locale: "en",
                      displayName: "Hero image",
                      altText: "A person standing near a bright landscape.",
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    vi.stubGlobal("fetch", fetchMock)

    const { generateLocalizedImageText } =
      await import("./image-text-generation.service")

    const result = await generateLocalizedImageText({
      imageDataUrl: "data:image/png;base64,abc",
      sourceName: "hero.png",
      locales: ["en"],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-openrouter-key",
        }),
      }),
    )
    expect(
      JSON.parse(fetchMock.mock.calls[0]![1]!.body as string),
    ).toMatchObject({
      model: "openrouter/free",
      messages: [
        {
          content: [
            { type: "text" },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,abc" },
            },
          ],
        },
      ],
      response_format: { type: "json_schema" },
    })
    expect(result).toEqual({
      status: "generated",
      values: [
        {
          locale: "en",
          displayName: "Hero image",
          altText: "A person standing near a bright landscape.",
        },
      ],
    })
  })

  it("tries configured fallback models and skips when all are rate-limited", async () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key"
    process.env.OPENROUTER_IMAGE_TEXT_MODELS = "model-a,model-b"
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              message: "Provider returned error",
              code: 429,
              metadata: {
                raw: "temporarily rate-limited upstream",
              },
            },
          }),
          { status: 429, headers: { "content-type": "application/json" } },
        ),
      ),
    )
    vi.stubGlobal("fetch", fetchMock)

    const { generateLocalizedImageText } =
      await import("./image-text-generation.service")

    const result = await generateLocalizedImageText({
      imageDataUrl: "data:image/png;base64,abc",
      sourceName: "hero.png",
      locales: ["en"],
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(
      fetchMock.mock.calls.map((call) => JSON.parse(call[1]!.body as string)),
    ).toMatchObject([{ model: "model-a" }, { model: "model-b" }])
    expect(result).toMatchObject({
      status: "skipped",
      reason: "provider_rate_limited",
    })
  })

  it("tries the next model when a configured model is unavailable", async () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key"
    process.env.OPENROUTER_IMAGE_TEXT_MODELS = "missing-model,working-model"
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "not found" } }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    locales: [
                      {
                        locale: "en",
                        displayName: "Hero image",
                        altText: "A person standing near a bright landscape.",
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
    vi.stubGlobal("fetch", fetchMock)

    const { generateLocalizedImageText } =
      await import("./image-text-generation.service")

    await expect(
      generateLocalizedImageText({
        imageDataUrl: "data:image/png;base64,abc",
        sourceName: "hero.png",
        locales: ["en"],
      }),
    ).resolves.toMatchObject({
      status: "generated",
      values: [{ locale: "en", displayName: "Hero image" }],
    })
    expect(
      fetchMock.mock.calls.map((call) => JSON.parse(call[1]!.body as string)),
    ).toMatchObject([{ model: "missing-model" }, { model: "working-model" }])
  })

  it("tries the next model when a response omits requested locales", async () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key"
    process.env.OPENROUTER_IMAGE_TEXT_MODELS = "partial-model,complete-model"
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    locales: [
                      {
                        locale: "en",
                        displayName: "Hero image",
                        altText: "A person standing near a bright landscape.",
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    locales: [
                      {
                        locale: "en",
                        displayName: "Hero image",
                        altText: "A person standing near a bright landscape.",
                      },
                      {
                        locale: "es",
                        displayName: "Imagen principal",
                        altText:
                          "Una persona de pie cerca de un paisaje luminoso.",
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
    vi.stubGlobal("fetch", fetchMock)

    const { generateLocalizedImageText } =
      await import("./image-text-generation.service")

    await expect(
      generateLocalizedImageText({
        imageDataUrl: "data:image/png;base64,abc",
        sourceName: "hero.png",
        locales: ["en", "es"],
      }),
    ).resolves.toMatchObject({
      status: "generated",
      values: [
        { locale: "en", displayName: "Hero image" },
        { locale: "es", displayName: "Imagen principal" },
      ],
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
