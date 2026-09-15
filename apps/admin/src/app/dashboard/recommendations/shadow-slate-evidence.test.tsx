import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ShadowSlateEvidence } from "./shadow-slate-evidence"

describe("shadow slate inspection", () => {
  it("separates the pending composition decision and missing inputs from the candidate evaluation", () => {
    const html = renderToStaticMarkup(
      <ShadowSlateEvidence
        nominations={[
          {
            ordinal: 0,
            targetMediaId: "video-a",
            provenance: {
              slatePolicy: "source-interest-theme-mmr-shadow-v1",
              slateRank: 2,
              slatePosition: 0,
              slateReasons: "position_moved",
              slateScore: 0.8,
              slateThemeSimilarity: 0,
              slateSourceGain: 1,
              slateInterestGain: 1,
              slateSourceCoverage: "2/2",
              slateInterestCoverage: "2/3",
              slateFallback: "none",
              slateLatencyMs: 0.4,
            },
          },
          {
            ordinal: 1,
            targetMediaId: "video-b",
            provenance: {
              slatePolicy: "source-interest-theme-mmr-shadow-v1",
              slateRank: 0,
              slateReasons: "outside_row_limit",
            },
          },
        ]}
      />,
    )
    expect(html).toContain("Composition policy comparison · decision pending")
    expect(html).toContain(
      "candidate evaluation decision above does not approve",
    )
    expect(html).toContain(
      "Recent history and published editorial constraints were not captured",
    )
    expect(html).toContain("Source coverage 2/2")
    expect(html).toContain("interest coverage 2/3")
    expect(html).toContain("Position Moved")
    expect(html).toContain("Outside Row Limit")
    expect(html).toContain(">3</td>")
    expect(html).toContain(">1</td>")
    expect(html).toContain(">none</td>")
  })

  it("keeps historical samples without a composition comparison unchanged", () => {
    expect(
      renderToStaticMarkup(
        <ShadowSlateEvidence
          nominations={[
            {
              ordinal: 0,
              targetMediaId: "video-a",
              provenance: { interestOrdinal: 1 },
            },
          ]}
        />,
      ),
    ).toBe("")
  })
})
