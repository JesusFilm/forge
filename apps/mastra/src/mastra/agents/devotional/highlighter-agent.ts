import { Agent } from "@mastra/core/agent"

import { SYSTEM_PROMPT } from "../../../services/devotional/reflection-highlighter"
import { devotionalModel } from "./model"

/**
 * Highlighter agent — picks the 3 strongest verbatim phrases across the whole
 * reflection for the orange-italic accent. Same model + instructions as the
 * pre-Mastra `reflection-highlighter` service.
 */
export const highlighterAgent = new Agent({
  id: "devotionalHighlighter",
  name: "Devotional Highlighter",
  instructions: SYSTEM_PROMPT,
  model: devotionalModel,
})
