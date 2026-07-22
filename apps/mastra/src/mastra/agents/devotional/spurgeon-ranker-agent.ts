import { Agent } from "@mastra/core/agent"

import { SYSTEM_PROMPT } from "../../../services/devotional/spurgeon-ranker"
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
  instructions: SYSTEM_PROMPT,
  model: devotionalModel,
})
