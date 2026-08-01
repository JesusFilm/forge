import { Agent } from "@mastra/core/agent"

import { requireResolvedInstructions } from "./instruction-resolver"
import { devotionalModel } from "./model"

/**
 * Spurgeon-ranker agent — judges which Spurgeon excerpt (if any) genuinely fits
 * the scene; index -1 means "none fits → fall back to on-passage commentary"
 * (the quality gate). Same model + instructions as the pre-Mastra
 * `spurgeon-ranker` service.
 */
export const spurgeonRankerAgent = new Agent({
  id: "devotionalSpurgeonRanker",
  name: "Devotional Spurgeon Ranker",
  instructions: () => requireResolvedInstructions("devotionalSpurgeonRanker"),
  model: devotionalModel,
})
