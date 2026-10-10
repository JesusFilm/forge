import { describe, expect, it, vi } from "vitest"
import { VideoNotFoundError } from "@/services/scene-recommendations.service"
import {
  buildSemanticCandidateMuxThumbnailUrl,
  getSemanticDeliveryRecommendations,
} from "./delivery-retriever"

const row = {
  seed_count: 24,
  video_id: "target-video",
  video_slug: "target",
  video_title: "Target video",
  video_core_id: "core-target",
  scene_index: 7,
  description: "A transcript-backed recommendation",
  start_seconds: "12.5",
  end_seconds: "42.25",
  duration_seconds: "252",
  themes: ["hope"],
  demographics: null,
  spiritual_context: ["discipleship"],
  playback_id: "mux-target",
  image_url: "https://images.example/target.jpg",
  similarity: "0.91",
  embedding_text: "[0.1,0.2]",
}

describe("semantic delivery retriever", () => {
  it("maps the ordered set-based result without changing the delivery DTO", async () => {
    const queryRaw = vi.fn(async () => [row])

    await expect(
      getSemanticDeliveryRecommendations({ $queryRaw: queryRaw } as never, {
        seedMediaId: "seed-video",
        locale: "en",
        audioLanguageSlug: "english",
        limit: 6,
      }),
    ).resolves.toEqual([
      {
        videoId: "target-video",
        videoSlug: "target",
        videoTitle: "Target video",
        imageUrl: "https://images.example/target.jpg",
        sceneIndex: 7,
        description: "A transcript-backed recommendation",
        startSeconds: 12.5,
        endSeconds: 42.25,
        durationSeconds: 252,
        similarity: 0.91,
        themes: ["hope"],
        demographics: [],
        spiritualContext: ["discipleship"],
        playbackId: "mux-target",
      },
    ])
    expect(queryRaw).toHaveBeenCalledOnce()
    expect(queryRaw.mock.calls[0]).toContain(36)
  })

  it("distinguishes a missing seed embedding from an eligible empty slate", async () => {
    const missingSeed = {
      $queryRaw: vi.fn(async () => [{ ...row, seed_count: 0, video_id: null }]),
    }
    await expect(
      getSemanticDeliveryRecommendations(missingSeed as never, {
        seedMediaId: "missing-seed",
        locale: "en",
        audioLanguageSlug: "english",
        limit: 6,
      }),
    ).rejects.toBeInstanceOf(VideoNotFoundError)

    const noCandidates = {
      $queryRaw: vi.fn(async () => [
        {
          ...row,
          seed_count: 4,
          video_id: null,
          video_slug: null,
          scene_index: null,
          description: null,
          start_seconds: null,
          playback_id: null,
          similarity: null,
          embedding_text: null,
        },
      ]),
    }
    await expect(
      getSemanticDeliveryRecommendations(noCandidates as never, {
        seedMediaId: "seed-with-no-candidates",
        locale: "en",
        audioLanguageSlug: "english",
        limit: 6,
      }),
    ).resolves.toEqual([])
  })

  it("supplies a bounded Mux scene thumbnail when stored artwork is unavailable", async () => {
    const queryRaw = vi.fn(async () => [
      {
        ...row,
        image_url: " ",
        playback_id: "mux target/one",
        start_seconds: "12.5",
      },
    ])

    const recommendations = await getSemanticDeliveryRecommendations(
      { $queryRaw: queryRaw } as never,
      {
        seedMediaId: "seed-video",
        locale: "en",
        audioLanguageSlug: "english",
        limit: 6,
      },
    )

    expect(recommendations[0]?.imageUrl).toBe(
      "https://image.mux.com/mux%20target%2Fone/thumbnail.jpg?time=12.5",
    )
    expect(
      buildSemanticCandidateMuxThumbnailUrl("mux-id", Number.POSITIVE_INFINITY),
    ).toBe("https://image.mux.com/mux-id/thumbnail.jpg?time=0")
    expect(buildSemanticCandidateMuxThumbnailUrl("mux-id", 90_000)).toBe(
      "https://image.mux.com/mux-id/thumbnail.jpg?time=86400",
    )
  })

  it("uses the requested audio-language slug for Dub eligibility", async () => {
    const queryRaw = vi.fn(async () => [row])

    await getSemanticDeliveryRecommendations({ $queryRaw: queryRaw } as never, {
      seedMediaId: "seed-video",
      locale: "en",
      audioLanguageSlug: "spanish-castilian",
      limit: 6,
    })

    expect(queryRaw.mock.calls[0]).toContain("spanish-castilian")
    expect(queryRaw.mock.calls[0]).toContain("en")
  })
})
