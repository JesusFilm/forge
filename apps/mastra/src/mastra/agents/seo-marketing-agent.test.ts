import { describe, expect, it } from "vitest"

import { seoMarketingAgent } from "./seo-marketing-agent"

describe("SEO Marketing Agent", () => {
  it("is stateless and exposes only read-only evidence/analysis tools", async () => {
    expect(await seoMarketingAgent.getMemory()).toBeUndefined()
    expect(Object.keys(await seoMarketingAgent.listTools()).sort()).toEqual([
      "seoAnalysisTool",
      "seoEvidenceCapabilitiesTool",
      "seoFirecrawlPageEvidenceTool",
      "seoGa4EvidenceTool",
      "seoGroundedSearchEvidenceTool",
      "seoGscEvidenceTool",
    ])
  })
})
