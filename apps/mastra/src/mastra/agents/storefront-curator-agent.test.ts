import { readFileSync } from "node:fs"

import { Agent } from "@mastra/core/agent"
import { Mastra } from "@mastra/core"
import { createTool } from "@mastra/core/tools"
import { describe, expect, it } from "vitest"
import { z } from "zod"

import {
  STOREFRONT_CURATOR_AGENT_ID,
  buildStorefrontCuratorAgent,
  getStorefrontCuratorAgent,
} from "./storefront-curator-agent"

describe("Storefront Curator agent", () => {
  it("is a zero-tool, non-publishing workflow-only agent", async () => {
    const storefrontCuratorAgent = getStorefrontCuratorAgent()
    expect(storefrontCuratorAgent.id).toBe(STOREFRONT_CURATOR_AGENT_ID)
    expect(Object.keys(await storefrontCuratorAgent.listTools())).toEqual([])
    const instructions = String(await storefrontCuratorAgent.getInstructions())
    expect(instructions).toContain("storefront administrator")
    expect(instructions).toContain("Never invent")
    expect(instructions).toContain("Russian, Spanish, French")
    expect(instructions).toContain("never publish")
  })

  it("keeps the private agent out of Mastra's agent and global tool registries", async () => {
    const probe = new Mastra({ agents: {} as never }) as unknown as {
      getAgentById: (id: string) => unknown
      listTools: () => Record<string, unknown>
    }

    expect(() => probe.getAgentById(STOREFRONT_CURATOR_AGENT_ID)).toThrow()
    expect(Object.keys(probe.listTools())).toEqual([])
    expect(
      Object.keys(await buildStorefrontCuratorAgent().listTools()),
    ).toEqual([])
  })

  it("does register a plain-object tool set (anti-vacuous companion)", () => {
    const probeTool = createTool({
      id: "storefront-registry-probe-tool",
      description: "Registry behavior probe",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async () => ({ ok: true }),
    })
    const probeAgent = new Agent({
      id: "storefront-registry-probe-agent",
      name: "Storefront Registry Probe",
      instructions: "Probe only.",
      model: "openrouter/google/gemma-4-31b-it:free",
      tools: { probeTool },
    })
    const probe = new Mastra({
      agents: { probeAgent } as never,
    }) as unknown as {
      listTools: () => Record<string, unknown>
    }

    expect(Object.keys(probe.listTools())).toEqual([
      "storefront-registry-probe-tool",
    ])
  })

  it("is imported by the workflow but absent from the application agent registry", () => {
    const indexSource = readFileSync(
      new URL("../index.ts", import.meta.url),
      "utf8",
    )
    const workflowSource = readFileSync(
      new URL("../workflows/storefront-homepage-curation.ts", import.meta.url),
      "utf8",
    )
    const agentsMap = /agents:\s*\{([\s\S]*?)\n\s*\},\n\s*workflows:/.exec(
      indexSource,
    )

    expect(agentsMap).not.toBeNull()
    expect(agentsMap?.[1]).toContain("seekerAgent")
    expect(agentsMap?.[1]).not.toContain("storefrontCuratorAgent")
    expect(workflowSource).toContain("getStorefrontCuratorAgent")
    expect(workflowSource).not.toContain(
      "getAgentById(STOREFRONT_CURATOR_AGENT_ID)",
    )
  })
})
