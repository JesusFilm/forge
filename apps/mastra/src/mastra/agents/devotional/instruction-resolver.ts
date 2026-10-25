/**
 * Bridge from devotional agents to verified Workspace prompt reads. U4
 * registers the attempt-scoped resolver after reconciliation. There is no
 * compiled prompt fallback: missing configuration fails before a provider call.
 */

type Resolver = (agentId: string) => Promise<string | null>

let resolver: Resolver | null = null

export function setInstructionResolver(r: Resolver): void {
  resolver = r
}

/** Workspace-authored instructions for the agent, or null when unavailable. */
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

export async function requireResolvedInstructions(
  agentId: string,
): Promise<string> {
  const instructions = await resolveStoredInstructions(agentId)
  if (!instructions?.trim()) {
    throw new Error(
      `/inputs/prompts/generation.json: instructions unavailable for ${agentId}`,
    )
  }
  return instructions
}
