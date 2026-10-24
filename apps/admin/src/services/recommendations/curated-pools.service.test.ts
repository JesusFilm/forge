import { describe, expect, it } from "vitest"
import {
  CuratedPoolInputError,
  materializeCuratedContext,
  parseCuratedPoolSource,
  requiredCuratedDepth,
  validateCuratedContexts,
  type CuratedHydratedVideo,
  type CuratedPoolSource,
} from "./curated-pools.types"

const context = {
  locale: "en",
  audioLanguageSlug: "english",
  coreLanguageId: "529",
}
const requirement = { requestedCount: 2, excludedReserve: 1 }
function source(): CuratedPoolSource {
  return parseCuratedPoolSource({
    schemaVersion: 1,
    version: "test-v1",
    themeVocabulary: [{ key: "hope" }],
    candidates: ["alpha", "beta", "gamma", "delta"].map((id, index) => ({
      coreVideoId: id,
      duplicateGroup: id,
      editorialRank: index + 1,
      startPool: true,
      themeKeys: index < 2 ? ["hope"] : [],
      rationale: "Editorial review",
    })),
  })
}
function videos(): CuratedHydratedVideo[] {
  return ["alpha", "beta", "gamma", "delta"].map((id) => ({
    videoId: `admin-${id}`,
    videoCoreId: id,
    videoSlug: id,
    videoTitle: id,
    description: "Description",
    imageUrl: "https://images.example/image.jpg",
    playbackId: id,
    durationSeconds: 120,
    embeddingText: null,
    rejectionReasons: [],
  }))
}

describe("curated editorial validation", () => {
  it("counts the unique union and preserves rank across overlapping pools", () => {
    const result = materializeCuratedContext(
      source(),
      videos(),
      context,
      true,
      requirement,
    )
    expect(result.coverage).toMatchObject({
      passed: true,
      startUnique: 4,
      unionUnique: 4,
      requiredUnique: 3,
    })
    expect(result.pools.get("hope")).toEqual(["admin-alpha", "admin-beta"])
    expect(result.pools.get("start")).toEqual([
      "admin-alpha",
      "admin-beta",
      "admin-gamma",
      "admin-delta",
    ])
  })

  it("resolves an eligible alternate without counting both editions", () => {
    const manifest = source()
    manifest.candidates[0]!.alternateCoreVideoIds.push("alpha-alternate")
    const rows = videos()
    rows.push({
      ...rows[0]!,
      videoId: "alternate-admin",
      videoCoreId: "alpha-alternate",
    })
    rows[0] = { ...rows[0]!, rejectionReasons: ["exact_audio_unavailable"] }
    const result = materializeCuratedContext(
      manifest,
      rows,
      context,
      true,
      requirement,
    )
    expect(result.coverage.startUnique).toBe(4)
    expect(result.pools.get("start")?.[0]).toBe("alternate-admin")
  })

  it.each([
    "watch_unavailable",
    "locale_unpublished",
    "exact_audio_unavailable",
    "artwork_unavailable",
  ])("excludes %s before checking reserve", (reason) => {
    const rows = videos().map((row, index) =>
      index < 2 ? { ...row, rejectionReasons: [reason] } : row,
    )
    const result = materializeCuratedContext(
      source(),
      rows,
      context,
      true,
      requirement,
    )
    expect(result.coverage).toMatchObject({ passed: false, startUnique: 2 })
    expect(result.coverage.rejected).toContainEqual({
      coreVideoId: "alpha",
      reason,
    })
  })

  it("rejects mismatched language identities and unresolved videos", () => {
    expect(
      materializeCuratedContext(source(), videos(), context, false, requirement)
        .coverage.startUnique,
    ).toBe(0)
    expect(
      materializeCuratedContext(source(), [], context, true, requirement)
        .coverage.rejected[0]?.reason,
    ).toBe("video_unresolved")
  })

  it("does not activate titles awaiting an explicit sensitivity review", () => {
    const manifest = source()
    manifest.candidates[0]!.sensitivityReviewRequired = true
    const result = materializeCuratedContext(
      manifest,
      videos(),
      context,
      true,
      requirement,
    )
    expect(result.coverage.startUnique).toBe(3)
    expect(result.coverage.rejected[0]?.reason).toBe("editorial_review_pending")
  })

  it.each(["prefix", "title", "embedding"])(
    "uses the runtime %s identity rule",
    (rule) => {
      const manifest = source(),
        rows = videos()
      if (rule === "prefix") {
        manifest.candidates[1]!.coreVideoId = "alpha-cut"
        rows[1] = { ...rows[1]!, videoCoreId: "alpha-cut" }
      } else if (rule === "title")
        rows[1] = { ...rows[1]!, videoTitle: "alpha" }
      else {
        rows[0] = { ...rows[0]!, embeddingText: "[1,0,0]" }
        rows[1] = { ...rows[1]!, embeddingText: "[1,0,0]" }
      }
      expect(
        materializeCuratedContext(manifest, rows, context, true, requirement)
          .coverage,
      ).toMatchObject({ startUnique: 3, unionUnique: 3 })
    },
  )

  it("rejects unknown themes, duplicate IDs, ranks and groups", () => {
    for (const mutate of [
      (item: CuratedPoolSource) => {
        item.candidates[1]!.coreVideoId = "alpha"
      },
      (item: CuratedPoolSource) => {
        item.candidates[1]!.duplicateGroup = "alpha"
      },
      (item: CuratedPoolSource) => {
        item.candidates[1]!.editorialRank = 1
      },
      (item: CuratedPoolSource) => {
        item.candidates[1]!.themeKeys = ["unknown"]
      },
      (item: CuratedPoolSource) => {
        item.candidates[1]!.alternateCoreVideoIds = ["alpha"]
      },
    ]) {
      const manifest = source()
      mutate(manifest)
      expect(() => parseCuratedPoolSource(manifest)).toThrow(
        CuratedPoolInputError,
      )
    }
  })

  it("rejects invalid context, count and reserve bounds", () => {
    expect(() => validateCuratedContexts([context, context])).toThrow(
      CuratedPoolInputError,
    )
    expect(() =>
      validateCuratedContexts([{ ...context, audioLanguageSlug: "English" }]),
    ).toThrow(CuratedPoolInputError)
    expect(() =>
      requiredCuratedDepth({ requestedCount: 21, excludedReserve: 0 }),
    ).toThrow(CuratedPoolInputError)
    expect(() =>
      requiredCuratedDepth({ requestedCount: 6, excludedReserve: -1 }),
    ).toThrow(CuratedPoolInputError)
  })
})
