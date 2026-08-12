import { describe, expect, it } from "vitest"

import {
  createEmptySeoRunReport,
  projectSeoRunReport,
  SEO_RUN_REPORT_MAX_BYTES,
  SeoRunReportSchema,
  serializedSeoRunReportBytes,
} from "./seo-run-report"

describe("SEO run report", () => {
  it("projects maximum-shape detail below the 256 KiB response budget", () => {
    const empty = createEmptySeoRunReport("2026-08-01T00:00:00.000Z")
    const report = projectSeoRunReport({
      ...empty,
      eligibleCount: 1_000,
      observedCount: 50,
      selectedCount: 50,
      wouldProposeCount: 50,
      persistedProposalCount: 50,
      providerCoverage: { gsc: "available" },
      skippedTargetIds: Array.from(
        { length: 1_000 },
        (_, index) => `target-${index}-${"s".repeat(180)}`,
      ),
      gscRequests: Array.from({ length: 50 }, (_, requestIndex) => ({
        propertyId: `sc-domain:${"p".repeat(470)}${requestIndex}`,
        startDate: "2026-07-01",
        endDate: "2026-07-28",
        dimensions: ["page", "query"],
        searchType: "web" as const,
        dataState: "final" as const,
        filters: Array.from({ length: 20 }, (_, filterIndex) => ({
          dimension: "query" as const,
          operator: "includingRegex" as const,
          expression: `${filterIndex}-${"f".repeat(495)}`,
        })),
        omittedFilterCount: 0,
        timezone: "America/Los_Angeles",
        configuredRowCap: 25_000,
        returnedRowCount: 25_000,
        pageCount: 25,
        requestCount: 50,
        capReached: true,
        responseAggregationType: "byPage",
        firstIncompleteDate: null,
        status: "partial" as const,
        caveats: Array.from(
          { length: 20 },
          (_, caveatIndex) => `${caveatIndex}-${"c".repeat(495)}`,
        ),
        omittedCaveatCount: 0,
      })),
      queryDecisions: Array.from({ length: 100 }, (_, index) => ({
        observationId: `observation-${index}-${"o".repeat(165)}`,
        targetId: `target-${index}-${"t".repeat(170)}`,
        locale: "en",
        canonicalUrl: `https://example.com/${"u".repeat(1_980)}`,
        query: "q".repeat(500),
        clicks: 0,
        impressions: 100,
        ctr: 0,
        position: 5,
        score: 100,
        selectionOutcome:
          index < 50 ? ("selected" as const) : ("not_selected" as const),
        reason:
          index < 50
            ? ("selected" as const)
            : ("proposal_limit_reached" as const),
      })),
      proposalRefs: Array.from({ length: 50 }, (_, index) => ({
        proposalId: `proposal-${index}-${"r".repeat(170)}`,
        payloadDigest: "a".repeat(64),
        disposition: "pending_persistence" as const,
      })),
    })

    expect(SeoRunReportSchema.parse(report)).toEqual(report)
    expect(serializedSeoRunReportBytes(report)).toBeLessThanOrEqual(
      SEO_RUN_REPORT_MAX_BYTES,
    )
    expect(serializedSeoRunReportBytes(report)).toBeLessThan(256 * 1_024)
    expect(report.omittedQueryDecisionCount).toBeGreaterThan(0)
    expect(
      report.omittedSkippedTargetCount + report.skippedTargetIds.length,
    ).toBe(1_000)
    expect(report.proposalRefs).toHaveLength(50)
    expect(
      report.queryDecisions.every(
        (decision) => decision.selectionOutcome === "selected",
      ),
    ).toBe(true)
  })

  it("rejects untyped GSC filter payloads at the report boundary", () => {
    expect(() =>
      projectSeoRunReport({
        ...createEmptySeoRunReport("2026-08-01T00:00:00.000Z"),
        gscRequests: [
          {
            propertyId: "sc-domain:example.com",
            startDate: "2026-07-01",
            endDate: "2026-07-28",
            dimensions: ["page", "query"],
            searchType: "web",
            dataState: "final",
            filters: [{ authorization: "Bearer raw" }],
            omittedFilterCount: 0,
            timezone: "America/Los_Angeles",
            configuredRowCap: 1,
            returnedRowCount: 0,
            pageCount: 0,
            requestCount: 0,
            capReached: false,
            responseAggregationType: null,
            firstIncompleteDate: null,
            status: "unavailable",
            caveats: [],
            omittedCaveatCount: 0,
          },
        ],
      } as never),
    ).toThrow()
  })
})
