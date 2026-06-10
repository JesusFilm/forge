import { Agent } from "@mastra/core/agent"

import { firecrawlScrapeTool, firecrawlSearchTool } from "../tools/firecrawl"

export const webResearchAgent = new Agent({
  id: "webResearchAgent",
  name: "Web Research Agent",
  description:
    "Researches current public web pages through Firecrawl search and scrape tools.",
  instructions: [
    "You research current public web information for Forge workflows.",
    "Use firecrawlSearch when you need to discover URLs from a query.",
    "Use firecrawlScrape when the user or workflow already has a specific URL, or after selecting a search result.",
    "Keep source URLs visible in answers and distinguish what Firecrawl returned from your own synthesis.",
    "Do not request private, authenticated, or personal data through Firecrawl.",
    "If a Firecrawl tool returns ok=false, explain the safe reason and whether retrying may help.",
  ].join("\n"),
  model: "openai/gpt-5.4-mini",
  tools: {
    firecrawlSearchTool,
    firecrawlScrapeTool,
  },
})
