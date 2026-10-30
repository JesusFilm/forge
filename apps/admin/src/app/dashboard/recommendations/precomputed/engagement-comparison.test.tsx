import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { blankCtrTotals } from "@/services/recommendations/precomputed/ctr-evidence"
import { buildEngagementReport } from "@/services/recommendations/precomputed/engagement-report"
import { EngagementComparison } from "./engagement-comparison"

describe("CTR and playback comparison", () => {
  it("preserves old report CTR and labels absent engagement as unavailable", () => {
    const html = renderToStaticMarkup(
      <EngagementComparison
        report={{
          byArm: { control: { visitCtr: 0.1 }, challenger: { visitCtr: 0.12 } },
        }}
      />,
    )
    expect(html).toContain("10.00%")
    expect(html).toContain("12.00%")
    expect(html).toContain("Engaged-view rate")
    expect(html).toContain("Active watch minutes / 100 eligible visits")
    expect(html).toContain("Not available")
    expect(html).toContain("Engagement was not included in this saved revision")
  })

  it("shows observed engagement alongside both capture denominators and unknown archives", () => {
    const totals = {
      ...blankCtrTotals(),
      eligibleVisits: 100n,
      engagementMeasuredVisits: 100n,
      acceptedSelections: 10n,
      engagedVisits: 6n,
      claimedPlaybacks: 8n,
      observedPlaybacks: 6n,
      completePlaybacks: 5n,
      partialPlaybacks: 1n,
      missingOutcomePlaybacks: 2n,
      activePlaybackMilliseconds: 600_000n,
    }
    const moments = {
      browsers: 100,
      eligibleVisits: 100,
      clickedVisits: 6,
      sumVisitsSquared: 100,
      sumClicksSquared: 6,
      sumVisitsClicks: 6,
      actualFallbackVisits: 0,
      unlinkedDeliveredVisits: 0,
    }
    const engagement = buildEngagementReport(
      {
        control: totals,
        challenger: { ...totals, engagementMeasuredVisits: 99n },
      },
      { control: moments, challenger: moments },
    )
    const html = renderToStaticMarkup(
      <EngagementComparison
        report={{
          byArm: { control: { visitCtr: 0.1 }, challenger: { visitCtr: 0.1 } },
          engagement,
        }}
      />,
    )
    expect(html).toContain("6.00%")
    expect(html).toContain("80.00%")
    expect(html).toContain("75.00%")
    expect(html).toContain("2 missing outcomes")
    expect(html).toContain("1 older visits with unavailable engagement")
    expect(html).toContain("secondary comparison alongside the frozen CTR")
  })
})
