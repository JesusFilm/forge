import { describe, expect, it } from "vitest"
import {
  adaptSemanticCandidates,
  type CandidateNomination,
  type RecommendationCandidateContext,
} from "../candidate"
import { runCandidatePlatform } from "../orchestration"
import { composeShadowSlate, type ShadowSlateEditorial } from "./slate-composer"

const context: RecommendationCandidateContext = {
  surface: "watch-below-player-v1",
  purpose: "watch",
  locale: "en",
  audioLanguageSlug: "english",
}

function candidates(
  items: ReadonlyArray<{
    id: string
    themes?: string[]
    interest?: number
    generator?: string
  }>,
) {
  const nominations = adaptSemanticCandidates(
    items.map((item) => ({
      videoId: item.id,
      videoCoreId: `core-${item.id}`,
      videoSlug: item.id,
      videoTitle: `Video ${item.id}`,
      imageUrl: `https://images.example/${item.id}.jpg`,
      sceneIndex: 0,
      description: "",
      startSeconds: 0,
      endSeconds: null,
      themes: item.themes ?? [],
      demographics: [],
      spiritualContext: [],
      playbackId: `playback-${item.id}`,
      similarity: 0.9,
    })),
    context,
  ).nominations.map((nomination, index): CandidateNomination => {
    const item = items[index]!
    return {
      ...nomination,
      source: {
        ...nomination.source,
        generator:
          item.generator ??
          (item.interest == null ? "semantic" : "multi-interest-profile"),
        evidence:
          item.interest == null
            ? {}
            : { interestOrdinal: item.interest, interestKind: "durable" },
      },
    }
  })
  return runCandidatePlatform({
    nominations,
    context,
    limit: 6,
    generatorVersion: "test",
  }).ordered
}

const ids = (result: ReturnType<typeof composeShadowSlate>) =>
  result.composed.map((item) => item.targetMediaId)

describe("shadow row composer", () => {
  it("trades repeated themes for source and interest coverage after item ranking", () => {
    const ordered = candidates([
      { id: "a", themes: ["hope"], interest: 0 },
      { id: "b", themes: ["hope"], interest: 0 },
      { id: "c", themes: ["prayer"], interest: 1 },
      { id: "d", themes: ["faith"], generator: "semantic" },
    ])
    const snapshot = JSON.stringify(ordered)
    const result = composeShadowSlate({ ordered, context, limit: 3 })
    expect(ids(result)).toEqual(["a", "c", "d"])
    expect(result.coverage).toMatchObject({
      sources: 2,
      availableSources: 2,
      interests: 2,
      availableInterests: 2,
    })
    expect(
      result.evidence.find((item) => item.targetMediaId === "d"),
    ).toMatchObject({
      reasonCodes: ["mmr_source_interest_coverage", "position_moved"],
      sourceGain: 1,
    })
    expect(result.decision).toBe("pending")
    expect(JSON.stringify(ordered)).toBe(snapshot)
  })

  it("keeps all fresh candidates ahead of known recent playback and refills only when needed", () => {
    const ordered = candidates(["a", "b", "c", "d"].map((id) => ({ id })))
    const result = composeShadowSlate({
      ordered,
      context,
      limit: 4,
      composition: {
        currentVideoId: "a",
        recentVideos: [
          { targetMediaId: "b", reasonCodes: ["recent_playback_start"] },
        ],
      },
    })
    expect(ids(result)).toEqual(["c", "d", "b"])
    expect(result.coverage.recentItems).toBe(1)
    expect(result.fallbackReason).toBe("sparse_eligible_pool")
    expect(
      result.evidence.find((item) => item.targetMediaId === "a")?.reasonCodes,
    ).toEqual(["current_video"])
    expect(
      result.evidence.find((item) => item.targetMediaId === "b")?.reasonCodes,
    ).toContain("recent_history_refill")
  })

  it.each([undefined, "unavailable-policy-v99"])(
    "preserves fixed order, pins and approved-pool boundaries with policy %s",
    (policyVersion) => {
      const ordered = candidates(["a", "b", "c", "d"].map((id) => ({ id })))
      const fixed = composeShadowSlate({
        ordered,
        context,
        limit: 3,
        policyVersion,
        editorial: { mode: "fixed", targetMediaIds: ["c", "a", "b"] },
      })
      expect(ids(fixed)).toEqual(["c", "a", "b"])
      const pinned = composeShadowSlate({
        ordered,
        context,
        limit: 3,
        policyVersion,
        editorial: {
          mode: "pinned_fill",
          approvedMediaIds: ["a", "b", "c"],
          pins: [
            { targetMediaId: "c", position: 0 },
            { targetMediaId: "a", position: 2 },
          ],
        },
      })
      expect(ids(pinned)).toEqual(["c", "b", "a"])
      expect(
        pinned.evidence.find((item) => item.targetMediaId === "c")?.reasonCodes,
      ).toContain("editorial_pin")
      const pool = composeShadowSlate({
        ordered,
        context,
        limit: 6,
        policyVersion,
        editorial: { mode: "approved_pool", approvedMediaIds: ["c", "d"] },
      })
      expect(ids(pool)).toEqual(["c", "d"])
      expect(
        pool.evidence.find((item) => item.targetMediaId === "a")?.reasonCodes,
      ).toEqual(["outside_approved_pool"])
    },
  )

  it.each<ShadowSlateEditorial>([
    { mode: "fixed", targetMediaIds: ["missing", "a"] },
    { mode: "fixed", targetMediaIds: ["a", "a"] },
    {
      mode: "pinned_fill",
      approvedMediaIds: ["a", "b"],
      pins: [{ targetMediaId: "a", position: 2 }],
    },
    {
      mode: "pinned_fill",
      approvedMediaIds: ["a", "b"],
      pins: [
        { targetMediaId: "a", position: 0 },
        { targetMediaId: "b", position: 0 },
      ],
    },
    {
      mode: "pinned_fill",
      approvedMediaIds: ["b"],
      pins: [{ targetMediaId: "a", position: 0 }],
    },
  ])(
    "fails closed when editorial constraints cannot be honored: %j",
    (editorial) => {
      const result = composeShadowSlate({
        ordered: candidates([{ id: "a" }, { id: "b" }]),
        context,
        limit: 3,
        editorial,
      })
      expect(ids(result)).toEqual([])
      expect(result.fallbackReason).toBe("editorial_constraints_unavailable")
    },
  )

  it("never fills a fixed pin with the current video or an ineligible locale", () => {
    const ordered = candidates([{ id: "a" }, { id: "b" }])
    expect(
      ids(
        composeShadowSlate({
          ordered,
          context,
          limit: 2,
          composition: { currentVideoId: "a" },
          editorial: { mode: "fixed", targetMediaIds: ["a", "b"] },
        }),
      ),
    ).toEqual([])
    expect(
      ids(
        composeShadowSlate({
          ordered,
          context: { ...context, locale: "fr" },
          limit: 2,
        }),
      ),
    ).toEqual([])
  })

  it("explains a pin overriding recent history separately from sparse refill", () => {
    const result = composeShadowSlate({
      ordered: candidates([{ id: "a" }, { id: "b" }]),
      context,
      limit: 2,
      composition: {
        recentVideos: [
          { targetMediaId: "a", reasonCodes: ["recent_playback_start"] },
        ],
      },
      editorial: {
        mode: "pinned_fill",
        approvedMediaIds: ["a", "b"],
        pins: [{ targetMediaId: "a", position: 0 }],
      },
    })
    expect(ids(result)).toEqual(["a", "b"])
    expect(result.evidence[0]?.reasonCodes).toContain(
      "editorial_overrides_recent_preference",
    )
    expect(result.evidence[0]?.reasonCodes).not.toContain(
      "recent_history_refill",
    )
  })

  it("reports missing labels honestly and never treats unrelated evidence as interests", () => {
    const result = composeShadowSlate({
      ordered: candidates([
        { id: "a", interest: 3, generator: "semantic" },
        { id: "b", interest: 99 },
      ]),
      context,
      limit: 2,
    })
    expect(result.coverage).toMatchObject({
      interests: 0,
      availableInterests: 0,
      itemsWithThemes: 0,
    })
    expect(result.evidence.every((item) => item.themeSimilarity === 0)).toBe(
      true,
    )
  })

  it("bounds deterministic unique rows over varied ranked candidate pools", () => {
    for (let seed = 0; seed < 48; seed += 1) {
      const ordered = candidates(
        Array.from({ length: seed + 1 }, (_, index) => ({
          id: `unique-video-${String(index).padStart(3, "0")}`,
          themes: [`theme-${(index * 17 + seed) % 7}`],
          ...(index % 3 === 0 ? { interest: index % 4 } : {}),
        })),
      )
      const input = { ordered, context, limit: seed % 11 }
      const result = composeShadowSlate(input)
      expect(ids(result)).toEqual(ids(composeShadowSlate(input)))
      expect(result.composed.length).toBeLessThanOrEqual(6)
      expect(new Set(ids(result)).size).toBe(result.composed.length)
      expect(
        result.composed.every(
          (item, index) =>
            item.composedPosition === index &&
            ordered.some(
              (candidate) => candidate.candidateKey === item.candidateKey,
            ),
        ),
      ).toBe(true)
    }
    expect(
      ids(
        composeShadowSlate({
          ordered: candidates([{ id: "a" }]),
          context,
          limit: NaN,
        }),
      ),
    ).toEqual([])
    const long = candidates(
      Array.from({ length: 80 }, (_, index) => ({
        id: `bounded-${String(index).padStart(3, "0")}`,
      })),
    )
    expect(
      composeShadowSlate({ ordered: long, context, limit: 80 }).evidence,
    ).toHaveLength(64)
  })
})
