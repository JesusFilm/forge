import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { SeoRunDetail } from "./seo-contract"
import { SeoRunDetailView } from "./seo-run-detail"

function run(overrides: Partial<SeoRunDetail> = {}): SeoRunDetail {
  return {
    id: "run-1",
    mode: "LIVE",
    status: "PARTIAL",
    startedAt: "2026-08-01T00:00:00.000Z",
    completedAt: "2026-08-01T00:01:00.000Z",
    eligibleCount: 10,
    selectedCount: 2,
    wouldProposeCount: 1,
    proposedCount: 1,
    materializationCount: 0,
    ticketCount: 0,
    experimentCount: 0,
    suppressedOperations: [],
    providerCoverage: { gsc: "partial" },
    reportAvailability: "available",
    reclaimed: false,
    report: {
      __typename: "ManagerSeoRunReportAvailable",
      schemaVersion: 1,
      detailState: "available",
      selectionPolicyId: "gsc-low-ctr-v1",
      generatedAt: "2026-08-01T00:01:00.000Z",
      eligibleCount: 10,
      observedCount: 5_000,
      selectedCount: 2,
      wouldProposeCount: 1,
      persistedProposalCount: 1,
      providerCoverage: [{ provider: "gsc", status: "partial" }],
      suppressedOperations: [],
      skippedTargetIds: [],
      omittedSkippedTargetCount: 0,
      omittedQueryDecisionCount: 0,
      gscRequests: [
        {
          propertyId: "sc-domain:jesusfilm.org",
          startDate: "2026-07-01",
          endDate: "2026-07-28",
          dimensions: ["query", "page"],
          searchType: "web",
          filters: [],
          omittedFilterCount: 0,
          timezone: "America/Los_Angeles",
          configuredRowCap: 25_000,
          returnedRowCount: 5_000,
          pageCount: 1,
          requestCount: 1,
          capReached: true,
          responseAggregationType: null,
          firstIncompleteDate: null,
          dataState: "final",
          status: "partial",
          caveats: [],
          omittedCaveatCount: 0,
        },
      ],
      omittedGscRequestCount: 0,
      queryFunnel: {
        providerRows: 5_000,
        malformedRows: 0,
        unmatchedTargetRows: 0,
        belowImpressionThresholdRows: 0,
        ctrThresholdNotMetRows: 0,
        rankedRows: 2,
        selectedQueryRows: 2,
        rejectedQueryRows: 0,
      },
      queryDecisions: [
        {
          observationId: "gsc-1",
          targetId: "video-jesus",
          locale: "en",
          query: "jesus film",
          canonicalUrl: "https://www.jesusfilm.org/watch/jesus.html",
          clicks: 10,
          impressions: 1_000,
          ctr: 0.01,
          position: 5,
          score: 1,
          selectionOutcome: "selected",
          reason: "selected",
        },
      ],
      proposalRefs: [],
    },
    proposalOutcomes: [],
    ...overrides,
  }
}

describe("SeoRunDetailView", () => {
  it("shows exact request scope and machine query decisions", () => {
    const markup = renderToStaticMarkup(
      React.createElement(SeoRunDetailView, {
        run: run(),
        returnHref: "/dashboard/seo?view=runs",
      }),
    )

    expect(markup).toContain("Search Console request scope")
    expect(markup).toContain("sc-domain:jesusfilm.org")
    expect(markup).toContain("cap reached")
    expect(markup).toContain("Evaluated query candidates")
    expect(markup).toContain("video-jesus")
    expect(markup).toContain("jesus film")
    expect(markup).toContain("selected")
  })

  it("explains expiry without rendering missing query evidence", () => {
    const markup = renderToStaticMarkup(
      React.createElement(SeoRunDetailView, {
        run: run({
          reportAvailability: "detail_expired",
          report: {
            __typename: "ManagerSeoRunReportCompacted",
            schemaVersion: 1,
            detailState: "detail_expired",
            selectionPolicyId: "gsc-low-ctr-v1",
            eligibleCount: 10,
            selectedCount: 2,
            wouldProposeCount: 1,
            persistedProposalCount: 1,
            providerCoverage: [{ provider: "gsc", status: "partial" }],
            suppressedOperations: [],
            proposalRefs: [],
            detailExpiresAt: "2026-08-01T00:01:00.000Z",
            compactedAt: "2026-08-30T00:01:00.000Z",
          },
        }),
        returnHref: "/dashboard/seo?view=runs",
      }),
    )

    expect(markup).toContain("Query and request detail expired after 29 days")
    expect(markup).not.toContain("jesus film")
    expect(markup).not.toContain("Search Console request scope")
  })

  it("shows dry-run proposal references without persisted outcomes", () => {
    const markup = renderToStaticMarkup(
      React.createElement(SeoRunDetailView, {
        run: run({
          mode: "DRY_RUN",
          proposedCount: 0,
          report: {
            __typename: "ManagerSeoRunReportAvailable",
            schemaVersion: 1,
            detailState: "available",
            selectionPolicyId: "gsc-low-ctr-v1",
            generatedAt: "2026-08-01T00:01:00.000Z",
            eligibleCount: 10,
            observedCount: 5,
            selectedCount: 1,
            wouldProposeCount: 1,
            persistedProposalCount: 0,
            providerCoverage: [{ provider: "gsc", status: "partial" }],
            suppressedOperations: ["proposal_persistence"],
            skippedTargetIds: [],
            omittedSkippedTargetCount: 0,
            gscRequests: [],
            omittedGscRequestCount: 0,
            queryFunnel: {
              providerRows: 5,
              malformedRows: 0,
              unmatchedTargetRows: 0,
              belowImpressionThresholdRows: 0,
              ctrThresholdNotMetRows: 0,
              rankedRows: 1,
              selectedQueryRows: 1,
              rejectedQueryRows: 0,
            },
            queryDecisions: [],
            omittedQueryDecisionCount: 0,
            proposalRefs: [
              {
                proposalId: "proposal-dry-run-1",
                payloadDigest: "a".repeat(64),
                disposition: "would_propose",
                version: null,
                originatingRunId: null,
              },
            ],
          },
          proposalOutcomes: [],
        }),
        returnHref: "/dashboard/seo?view=runs",
      }),
    )

    expect(markup).toContain("proposal-dry-run-1")
    expect(markup).toContain("would propose")
    expect(markup).toContain("a".repeat(64))
    expect(markup).not.toContain("No persisted proposal outcomes")
  })
})
