import { beforeEach, describe, expect, it, vi } from "vitest"

const { envState } = vi.hoisted(() => ({
  envState: {
    OPENROUTER_API_KEY: "test-key" as string | undefined,
    OPENROUTER_EXPERIENCE_CHAT_MODEL: undefined as string | undefined,
    OPENROUTER_EXPERIENCE_CHAT_MODELS: "model-a" as string | undefined,
  },
}))

vi.mock("@/config/env", () => ({ env: envState }))

import type { EditorialBrief } from "./experience-ai-chat-brief"
import type { VideoCandidate } from "./experience-ai.schemas"
import { generateQualityExperienceDraft } from "./experience-ai-quality-draft"

const brief: EditorialBrief = {
  topicOrPassage: "Matthew 11:28-30",
  language: "English",
  audience: "young adults",
  desiredOutcome: "Help readers trust Jesus with weariness.",
  tone: "Warm and invitational",
  pageType: "Experience page",
  scriptureEmphasis: "Center the page on Matthew 11:28-30.",
  ctaOrNextStep: "Invite readers to pray and begin a short Bible study.",
}

const candidates: VideoCandidate[] = [
  {
    ref: "v01",
    videoId: "video-1",
    slug: "rest",
    title: "Rest",
    description: "A film about finding rest.",
    previewImageUrl: "https://example.com/rest.jpg",
    previewStreamUrl: "https://example.com/rest.m3u8",
    label: "SHORT_FILM",
  },
]

function packagePayload(overrides: Record<string, unknown> = {}) {
  return {
    draft: {
      title: "Come to Me",
      metaDescription: "A guided page about Jesus' invitation to rest.",
      blocks: [
        {
          t: "videoHero",
          sectionRef: "s01",
          candidateRef: "v01",
          heading: "Come to Jesus with your weariness",
        },
        {
          t: "text",
          sectionRef: "s02",
          heading: "An invitation to rest",
          contentParagraphs: [
            "Jesus speaks to people who are tired and carrying heavy burdens.",
          ],
        },
      ],
    },
    review: {
      scriptureNotes: ["Matthew 11:28-30 is the primary passage."],
      researchNotes: ["No external sources were supplied."],
      theologyReview: { status: "passed", notes: [] },
      referenceLedger: [
        {
          sourceKind: "scripture",
          claim: "Jesus invites the weary to come to him.",
          reference: "Matthew 11:28-30",
        },
        {
          sourceKind: "video_candidate",
          claim: "The hero references the selected Rest video.",
          reference: "Rest",
          candidateRef: "v01",
        },
      ],
    },
    ...overrides,
  }
}

function okResponse(payload: unknown) {
  return new Response(
    JSON.stringify({
      model: "model-a",
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

describe("generateQualityExperienceDraft", () => {
  beforeEach(() => {
    envState.OPENROUTER_API_KEY = "test-key"
    envState.OPENROUTER_EXPERIENCE_CHAT_MODELS = "model-a"
  })

  it("returns normalized public content and admin review metadata", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(packagePayload()))

    const result = await generateQualityExperienceDraft({
      brief,
      locale: "en",
      candidates,
      fetchImpl,
    })

    expect(result.title).toBe("Come to Me")
    expect(result.blocks[0]).toMatchObject({
      t: "videoHero",
      videoId: "video-1",
    })
    expect(result.review.referenceLedger).toHaveLength(2)
    expect(result.provider).toMatchObject({
      kind: "openrouter-free",
      model: "model-a",
      usedModel: "model-a",
    })
  })

  it("rejects unknown external URLs in the review ledger", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      okResponse(
        packagePayload({
          review: {
            ...packagePayload().review,
            referenceLedger: [
              {
                sourceKind: "scripture",
                claim: "Unsupported URL",
                reference: "Unknown site",
                url: "https://example.com/source",
              },
            ],
          },
        }),
      ),
    )

    await expect(
      generateQualityExperienceDraft({
        brief,
        locale: "en",
        candidates,
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      name: "QualityExperienceDraftError",
      code: "provider_validation_failed",
    })
  })

  it("maps missing OpenRouter key to provider_not_configured", async () => {
    envState.OPENROUTER_API_KEY = undefined

    await expect(
      generateQualityExperienceDraft({
        brief,
        locale: "en",
        candidates,
        fetchImpl: vi.fn(),
      }),
    ).rejects.toMatchObject({
      name: "QualityExperienceDraftError",
      code: "provider_not_configured",
    })
  })
})

// -----------------------------------------------------------------------------
// 4-channel routing (U6): each ChatProvider value routes to the right adapter
// and stamps the right `provider.kind`. Adapter internals are exercised by
// their own test files; here we mock the adapter functions to assert routing.
// -----------------------------------------------------------------------------

describe("generateQualityExperienceDraft — provider routing", () => {
  beforeEach(() => {
    envState.OPENROUTER_API_KEY = "test-key"
    envState.OPENROUTER_EXPERIENCE_CHAT_MODELS = "model-a"
  })

  // The adapter modules are mocked at the top of this describe so each
  // branch test can re-stub the implementation. We import them lazily so
  // the existing OpenRouter tests above run unmodified.
  it("routes provider='ollama' to the Ollama adapter and stamps ollama-gemma4", async () => {
    const ollamaMod = await import("./experience-ai-ollama")
    const spy = vi
      .spyOn(ollamaMod, "generateOllamaStructuredOutput")
      .mockResolvedValue({
        payload: packagePayload() as never,
        model: "gemma4:e4b",
        usedModel: "gemma4:e4b",
        attempts: [
          { model: "gemma4:e4b", usedModel: "gemma4:e4b", status: "succeeded" },
        ],
      })

    const result = await generateQualityExperienceDraft({
      brief,
      locale: "en",
      candidates,
      provider: "ollama",
    })

    expect(spy).toHaveBeenCalledTimes(1)
    expect(result.provider).toMatchObject({
      kind: "ollama-gemma4",
      model: "gemma4:e4b",
      usedModel: "gemma4:e4b",
    })
    spy.mockRestore()
  })

  it("routes provider='codex' to the Codex adapter and stamps codex", async () => {
    const codexMod = await import("./experience-ai-codex")
    const spy = vi
      .spyOn(codexMod, "generateCodexStructuredOutput")
      .mockResolvedValue({
        payload: packagePayload() as never,
        model: "gpt-5.5",
        usedModel: "gpt-5.5",
        attempts: [
          { model: "gpt-5.5", usedModel: "gpt-5.5", status: "succeeded" },
        ],
      })

    const result = await generateQualityExperienceDraft({
      brief,
      locale: "en",
      candidates,
      provider: "codex",
    })

    expect(spy).toHaveBeenCalledTimes(1)
    expect(result.provider).toMatchObject({
      kind: "codex",
      model: "gpt-5.5",
    })
    spy.mockRestore()
  })

  it("routes provider='claude-code' to the Claude Code adapter and stamps claude-code", async () => {
    const claudeMod = await import("./experience-ai-claude-code")
    const spy = vi
      .spyOn(claudeMod, "generateClaudeCodeStructuredOutput")
      .mockResolvedValue({
        payload: packagePayload() as never,
        model: "sonnet",
        usedModel: "sonnet",
        attempts: [
          { model: "sonnet", usedModel: "sonnet", status: "succeeded" },
        ],
      })

    const result = await generateQualityExperienceDraft({
      brief,
      locale: "en",
      candidates,
      provider: "claude-code",
    })

    expect(spy).toHaveBeenCalledTimes(1)
    expect(result.provider).toMatchObject({
      kind: "claude-code",
      model: "sonnet",
    })
    spy.mockRestore()
  })

  it("maps Ollama timeout to provider_timeout", async () => {
    const ollamaMod = await import("./experience-ai-ollama")
    const spy = vi
      .spyOn(ollamaMod, "generateOllamaStructuredOutput")
      .mockRejectedValue(
        new ollamaMod.OllamaProviderError("timeout", "took too long"),
      )

    await expect(
      generateQualityExperienceDraft({
        brief,
        locale: "en",
        candidates,
        provider: "ollama",
      }),
    ).rejects.toMatchObject({
      name: "QualityExperienceDraftError",
      code: "provider_timeout",
    })
    spy.mockRestore()
  })

  it("maps Codex missing_provider to provider_not_configured", async () => {
    const codexMod = await import("./experience-ai-codex")
    const spy = vi
      .spyOn(codexMod, "generateCodexStructuredOutput")
      .mockRejectedValue(
        new codexMod.CodexProviderError("missing_provider", "gate off"),
      )

    await expect(
      generateQualityExperienceDraft({
        brief,
        locale: "en",
        candidates,
        provider: "codex",
      }),
    ).rejects.toMatchObject({
      name: "QualityExperienceDraftError",
      code: "provider_not_configured",
    })
    spy.mockRestore()
  })

  it("maps Claude Code validation_error to provider_validation_failed", async () => {
    const claudeMod = await import("./experience-ai-claude-code")
    const spy = vi
      .spyOn(claudeMod, "generateClaudeCodeStructuredOutput")
      .mockRejectedValue(
        new claudeMod.ClaudeCodeProviderError(
          "validation_error",
          "bad shape",
        ),
      )

    await expect(
      generateQualityExperienceDraft({
        brief,
        locale: "en",
        candidates,
        provider: "claude-code",
      }),
    ).rejects.toMatchObject({
      name: "QualityExperienceDraftError",
      code: "provider_validation_failed",
    })
    spy.mockRestore()
  })

  it("falls back to OpenRouter when provider is omitted (R8 invariant)", async () => {
    // Existing OpenRouter happy path covers this; this test pins it
    // explicitly as a regression guard against accidental default
    // changes.
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(packagePayload()))

    const result = await generateQualityExperienceDraft({
      brief,
      locale: "en",
      candidates,
      fetchImpl,
    })

    expect(result.provider.kind).toBe("openrouter-free")
  })
})
