import { Agent } from "@mastra/core/agent"

import { SAFETY_SYSTEM_PROMPT } from "../../../services/devotional/safety-gate"
import { devotionalSafetyModel } from "./model"

/**
 * Safety agent — the LLM judge behind the devotional safety gate (doctrine /
 * tone / sensitivity). Same model + instructions as the pre-Mastra service.
 * The gate's fail-closed logic and final verdict stay IN CODE
 * (`safety-gate.ts`); this agent only supplies the judge scores.
 * id/name/model stay in code; instructions become Studio-editable.
 */
export const safetyAgent = new Agent({
  id: "devotionalSafety",
  name: "Devotional Safety Judge",
  instructions: SAFETY_SYSTEM_PROMPT,
  model: devotionalSafetyModel,
})
