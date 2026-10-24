import { describe, expect, it } from "vitest"

import { getSeoConfig } from "../../config/seo"

import {
  buildSeoMarketingAgent,
  seoMarketingAgent,
} from "./seo-marketing-agent"

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

  it("binds paid-first OpenRouter access to the SEO reasoning model", async () => {
    const agent = buildSeoMarketingAgent(
      getSeoConfig({
        OPENROUTER_API_PAID_KEY: "paid-test-key",
        SEO_OPENROUTER_MODEL: "openai/gpt-5.4-mini",
      }),
    )

    await expect(agent.getModel()).resolves.toMatchObject({
      modelId: "openai/gpt-5.4-mini",
      provider: "openrouter.chat",
    })
  })
})
