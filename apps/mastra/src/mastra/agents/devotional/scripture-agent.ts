import { Agent } from "@mastra/core/agent"

import { SYSTEM_PROMPT } from "../../../services/devotional/passage-scripture"
import { devotionalModel } from "./model"

/**
 * Scripture agent — picks the key verse from the clip's Gospel passage. Same
 * model + instructions as the pre-Mastra `passage-scripture` service; the exact
 * WEB verse text is still looked up afterward. id/name/model stay in code;
 * instructions are Studio-editable via @mastra/editor.
 */
export const scriptureAgent = new Agent({
  id: "devotionalScripture",
  name: "Devotional Scripture",
  instructions: SYSTEM_PROMPT,
  model: devotionalModel,
})
