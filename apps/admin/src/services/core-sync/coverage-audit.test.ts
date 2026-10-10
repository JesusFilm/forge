import { describe, expect, it } from "vitest"
import { runCoverageAudit } from "./coverage-audit"

function delegate(count: number) {
  return { count: async () => count }
}

describe("runCoverageAudit", () => {
  it("passes when approved Core entity classes have persisted coverage", async () => {
    const prisma = {
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
      ]),
    )
  })

  it("flags missing required coverage for review", async () => {
    const prisma = {
      language: delegate(1),
      languageLocale: delegate(1),
      country: delegate(1),
      countryLocale: delegate(1),
      continentLocale: delegate(1),
      countryLanguage: delegate(0),
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

    const audit = await runCoverageAudit(prisma as never)

    expect(audit.status).toBe("review")
    expect(audit.checks).toContainEqual(
      expect.objectContaining({
        key: "countryLanguages",
        status: "missing",
      }),
    )
  })
})
