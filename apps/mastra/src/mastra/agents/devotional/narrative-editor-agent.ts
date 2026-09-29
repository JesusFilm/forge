import { Agent } from "@mastra/core/agent"

import { SYSTEM_PROMPT } from "../../../services/devotional/narrative-editor"
import { devotionalModel } from "./model"

/**
 * Narrative editor agent — the final read of the reflection as one spoken
 * piece (throughline, tangents, repetition, over-explaining, planted
 * associations) and of each paragraph's claims against the source credited on
 * screen. Instructions are editable in Studio; the model is pinned in
 * devotional-models.ts ("narrativeEditor"). See narrative-editor.ts.
 */
export const narrativeEditorAgent = new Agent({
  id: "devotionalNarrativeEditor",
  name: "Devotional Narrative Editor",
  instructions: SYSTEM_PROMPT,
  model: devotionalModel,
})
