import { Agent } from "@mastra/core/agent"

export const smokeAgent = new Agent({
  id: "smokeAgent",
  name: "Smoke Agent",
  instructions:
    "You are a small deployment smoke-test agent. Respond tersely and never access Forge data.",
  model: "openai/gpt-5.4-mini",
})

export function createSmokeResponse(input: string) {
  return {
    ok: true,
    agentId: "smokeAgent",
    echo: input,
  }
}
