import { describe, expect, it } from "vitest"
import {
  PrecomputedSourceEligibilityUnavailableError,
  readPrecomputedWatchChoices,
  selectPlayablePrecomputedChoices,
} from "./watch-reader"

const video = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  slug: id,
  deletedAt: null,
  restrictViewPlatforms: [],
  locales: [{ locale: "en", title: `Title ${id}`, status: "PUBLISHED" }],
  dubs: [
    {
      published: true,
      language: { slug: "english" },
      muxVideo: { playbackId: `playback-${id}`, deletedAt: null },
      duration: 60,
      lengthInMilliseconds: null,
    },
  ],
  images: [{ mobileCinematicHigh: `https://example.org/${id}.jpg` }],
  ...overrides,
})

describe("saved Watch choice selection", () => {
  it("fails closed before generation access if source eligibility cannot be verified", async () => {
    const findFirst = async () => {
      throw new Error("generation should not be read")
    }
    const prisma = {
      video: {
        findUnique: async () => {
          throw new Error("database unavailable")
        },
      },
      recommendationPrecomputedGeneration: { findFirst },
    } as never
    await expect(
      readPrecomputedWatchChoices(prisma, {
        seedMediaId: "source",
        locale: "en",
        audioLanguageSlug: "english",
      }),
    ).rejects.toBeInstanceOf(PrecomputedSourceEligibilityUnavailableError)
  })

  it("fills six slots from every saved edge after filtering, with alternatives after direct choices", () => {
    const choices = Array.from({ length: 9 }, (_, index) => ({
      targetVideoId: `v${index + 1}`,
      kind: index < 7 ? ("direct" as const) : ("alternative" as const),
      rank: index < 7 ? index + 1 : index - 6,
      relationship: "related",
      reasonEnglish: "A useful connection to the source video.",
      evidence: { basis: "metadata" as const, fields: ["title"] },
    }))
    const videos = choices.map((choice) => video(choice.targetVideoId))
    videos[1] = video("v2", { dubs: [] })
    videos[2] = video("v3", { restrictViewPlatforms: ["watch"] })
    const result = selectPlayablePrecomputedChoices({
      choices,
      videos,
      sourceVideoId: "source",
      locale: "en",
      audioLanguageSlug: "english",
    })
    expect(result.items.map((item) => item.videoId)).toEqual([
      "v1",
      "v4",
      "v5",
      "v6",
      "v7",
      "v8",
    ])
    expect(result.gaps).toEqual([
      { targetVideoId: "v2", reason: "audio_unavailable" },
      { targetVideoId: "v3", reason: "watch_unavailable" },
    ])
  })

  it("accepts one edge and distinguishes valid empty from changed language availability", () => {
    const choice = {
      targetVideoId: "one",
      kind: "direct" as const,
      rank: 1,
      relationship: "related",
      reasonEnglish: "A useful connection to the source video.",
      evidence: { basis: "metadata" as const, fields: ["title"] },
    }
    expect(
      selectPlayablePrecomputedChoices({
        choices: [choice],
        videos: [video("one")],
        sourceVideoId: "source",
        locale: "en",
        audioLanguageSlug: "english",
      }).items,
    ).toHaveLength(1)
    expect(
      selectPlayablePrecomputedChoices({
        choices: [choice],
        videos: [video("one")],
        sourceVideoId: "source",
        locale: "en",
        audioLanguageSlug: "spanish",
      }),
    ).toMatchObject({ items: [], coverageGap: "no_playable_connections" })
    expect(
      selectPlayablePrecomputedChoices({
        choices: [],
        videos: [],
        sourceVideoId: "source",
        locale: "en",
        audioLanguageSlug: "english",
      }),
    ).toMatchObject({ items: [], coverageGap: "no_connections" })
  })
})
