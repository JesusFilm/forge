import { Agent } from "@mastra/core/agent"

import { SYSTEM_PROMPT } from "../../../services/devotional/reflection-modernizer"
import { devotionalModel } from "./model"

/**
 * Modernizer agent — adapts a public-domain reflection excerpt (Henry / Ryle /
 * Spurgeon) for a modern listener: insight/application only (no plot retell),
 * light-touch language modernization, 2–3 short paragraphs. Same model +
 * instructions as the pre-Mastra `reflection-modernizer` service.
 */
export const modernizerAgent = new Agent({
  id: "devotionalModernizer",
  name: "Devotional Reflection Modernizer",
  instructions: SYSTEM_PROMPT,
  model: devotionalModel,
})
