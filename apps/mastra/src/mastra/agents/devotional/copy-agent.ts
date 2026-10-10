import { Agent } from "@mastra/core/agent"

import { requireResolvedInstructions } from "./instruction-resolver"
import { devotionalModel } from "./model"

/**
 * Copy agent — writes the short on-screen/spoken copy: a scroll-stopping cover
 * HOOK, one memorable conclusion line, ONE practical question, and a one-line
 * invitation to pray. Same model + instructions as the pre-Mastra
 * `devotional-copy` service.
 */
export const copyAgent = new Agent({
  id: "devotionalCopy",
  name: "Devotional Copywriter",
  instructions: () => requireResolvedInstructions("devotionalCopy"),
  model: devotionalModel,
})
