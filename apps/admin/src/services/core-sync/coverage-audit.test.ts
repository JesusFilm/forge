import { describe, expect, it, vi } from "vitest"

vi.mock("./core-client", () => ({
  coreQuery: vi.fn(),
}))

vi.mock("./phases/sync-video-images", () => ({
  fetchCoreImageIdSet: vi.fn(),
}))

import { coreQuery } from "./core-client"
import { fetchCoreImageIdSet } from "./phases/sync-video-images"
import { runCoverageAudit } from "./coverage-audit"

const mockedCoreQuery = vi.mocked(coreQuery)
const mockedFetchCoreImageIdSet = vi.mocked(fetchCoreImageIdSet)

function delegate(count: number) {
  return { count: async () => count }
}

function baseAdminCounts() {
  return {
    language: delegate(1),
    languageLocale: delegate(1),
    country: delegate(1),
    countryLocale: delegate(1),
    continentLocale: delegate(1),
    countryLanguage: delegate(1),
    keyword: delegate(1),
    video: delegate(1),
    videoLocale: delegate(1),
    videoImage: delegate(1),
    videoSubtitle: delegate(1),
    videoStudyQuestion: delegate(1),
    bibleCitation: delegate(1),
    videoKeyword: delegate(1),
    videoRelation: delegate(0),
    videoDub: delegate(1),
    videoDubDownload: delegate(1),
    videoEdition: delegate(1),
    muxVideo: delegate(0),
  }
}

describe("runCoverageAudit", () => {
  it("passes when approved Core entity classes have persisted coverage", async () => {
    // Core counts must equal the Admin counts below so this test stays a
    // real pass rather than passing because the Core side is absent.
    mockedCoreQuery.mockResolvedValue({ data: { videoSubtitlesCount: 1 } })
    mockedFetchCoreImageIdSet.mockResolvedValue({ ids: new Set(["img-1"]) })

    const prisma = baseAdminCounts()

    const audit = await runCoverageAudit(prisma as never)

    expect(audit.status).toBe("pass")
    expect(audit.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "countryLanguages",
          status: "covered",
          confidence: "relationship-count",
        }),
        expect.objectContaining({
          key: "videoRelations",
          status: "empty-ok",
        }),
        expect.objectContaining({
          key: "videoSubtitles",
          status: "covered",
          confidence: "core-count",
          adminCount: 1,
          coreCount: 1,
        }),
        expect.objectContaining({
          key: "videoImages",
          status: "covered",
          confidence: "core-count",
          adminCount: 1,
          coreCount: 1,
        }),
      ]),
    )
  })

  it("flags missing required coverage for review", async () => {
    mockedCoreQuery.mockResolvedValue({ data: { videoSubtitlesCount: 1 } })
    mockedFetchCoreImageIdSet.mockResolvedValue({ ids: new Set(["img-1"]) })

    const prisma = {
      ...baseAdminCounts(),
      countryLanguage: delegate(0),
    }

    const audit = await runCoverageAudit(prisma as never)

    expect(audit.status).toBe("review")
    expect(audit.checks).toContainEqual(
      expect.objectContaining({
        key: "countryLanguages",
        status: "missing",
      }),
    )
  })

  it("reports missing video-subtitle coverage when Admin trails Core's videoSubtitlesCount", async () => {
    mockedCoreQuery.mockResolvedValue({ data: { videoSubtitlesCount: 10 } })
    mockedFetchCoreImageIdSet.mockResolvedValue({ ids: new Set(["img-1"]) })

    const prisma = {
      ...baseAdminCounts(),
      videoSubtitle: delegate(9),
    }

    const audit = await runCoverageAudit(prisma as never)

    expect(audit.status).toBe("review")
    expect(audit.checks).toContainEqual(
      expect.objectContaining({
        key: "videoSubtitles",
        status: "missing",
        coreCount: 10,
        adminCount: 9,
        confidence: "core-count",
      }),
    )
  })

  it("reports missing video-image coverage when Admin trails Core's image id set", async () => {
    mockedCoreQuery.mockResolvedValue({ data: { videoSubtitlesCount: 1 } })
    mockedFetchCoreImageIdSet.mockResolvedValue({
      ids: new Set(["img-1", "img-2", "img-3", "img-4", "img-5", "img-6"]),
    })

    const prisma = {
      ...baseAdminCounts(),
      videoImage: delegate(5),
    }

    const audit = await runCoverageAudit(prisma as never)

    expect(audit.status).toBe("review")
    expect(audit.checks).toContainEqual(
      expect.objectContaining({
        key: "videoImages",
        status: "missing",
        coreCount: 6,
        adminCount: 5,
        confidence: "core-count",
      }),
    )
  })

  it("degrades to row-count coverage when the Core read throws, without failing the audit", async () => {
    mockedCoreQuery.mockRejectedValue(new Error("Core API unreachable"))
    mockedFetchCoreImageIdSet.mockRejectedValue(
      new Error("Core API unreachable"),
    )
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const prisma = baseAdminCounts()

    const audit = await runCoverageAudit(prisma as never)

    const videoSubtitlesCheck = audit.checks.find(
      (check) => check.key === "videoSubtitles",
    )
    expect(videoSubtitlesCheck).toMatchObject({
      status: "covered",
      confidence: "row-count",
      adminCount: 1,
    })
    expect(videoSubtitlesCheck).not.toHaveProperty("coreCount")

    const videoImagesCheck = audit.checks.find(
      (check) => check.key === "videoImages",
    )
    expect(videoImagesCheck).toMatchObject({
      status: "covered",
      confidence: "row-count",
      adminCount: 1,
    })
    expect(videoImagesCheck).not.toHaveProperty("coreCount")
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "core-sync.coverage-audit.core-count-unavailable",
      ),
    )

    errorSpy.mockRestore()
  })
})
