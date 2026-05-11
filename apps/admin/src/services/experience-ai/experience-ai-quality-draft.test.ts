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
