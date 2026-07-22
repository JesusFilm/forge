/**
 * Bridge from the devotional agents to Studio-published instruction edits.
 *
 * Studio/editor edits live as STORED agent configs resolved via
 * `mastra.getEditor().agent.getById(id)` — a module-level `agent.getInstructions()`
 * does NOT see them (verified empirically). The Mastra index registers a
 * resolver here after constructing the instance; the hybrid agent-llm adapter
 * consults it first and falls back to the coded instructions. A registry module
 * (instead of importing the mastra instance) avoids the index → workflows →
 * adapter → index import cycle.
 */

type Resolver = (agentId: string) => Promise<string | null>

let resolver: Resolver | null = null

export function setInstructionResolver(r: Resolver): void {
  resolver = r
}

/** Studio-published instructions for the agent, or null (no editor / no stored
 *  config / any failure → caller falls back to coded instructions). */
export async function resolveStoredInstructions(
  agentId: string,
): Promise<string | null> {
  if (!resolver) return null
  try {
    return await resolver(agentId)
  } catch {
    return null
  }
}
