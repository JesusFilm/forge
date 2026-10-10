/**
 * `featureVideo` tool for the seeker agent (feat-327, plan D4/P3).
 *
 * The SELECTION DECLARATION. `searchVideos` returns candidates, the model
 * re-ranks them (E5) and declares its single pick by calling this tool with
 * that candidate's `videoId`. The `/forge-seeker` route reads the declaration
 * out of the turn's tool RESULT chunks — the same `toolResults` path
 * `extractSources` already uses — and attaches the projected video to the
 * terminal `result` frame.
 *
 * Why a tool and not text inference: title-matching the reply is structurally
 * broken on paraphrase, translation, and partial titles (E6), and any
 * reply-embedded marker would ride the untrusted model TEXT stream that plan
 * D9 exists to distrust. A tool call is a declaration on a channel the route
 * already trusts structurally.
 *
 * Execute is a PURE ECHO — it validates shape and returns `{ videoId }`. It
 * performs no lookup and grants nothing: the route attaches a video only if the
 * declared id is present in THIS turn's own projected search results, so the
 * model can never author a payload or name a video it did not just see.
 *
 * Input is `{ videoId }` and nothing else — no titles, no URLs, no free text
 * (plan P3). Every displayed field comes from the search result row the route
 * projects itself.
 *
 * Failure semantics live entirely in the route's ladder (plan P3): a missing,
 * malformed, or non-matching declaration attaches nothing and never produces an
 * error frame.
 */

import { createTool } from "@mastra/core/tools"
import { z } from "zod"

/** Tool id as the model and the route both see it. */
export const FEATURE_VIDEO_TOOL_NAME = "featureVideo"

export const featureVideoInputSchema = z.object({
  videoId: z
    .string()
    .min(1)
    .describe(
      "The videoId of the ONE searchVideos result you are featuring, copied verbatim. Never invent an id.",
    ),
})

export const featureVideoOutputSchema = z.object({
  videoId: z.string(),
})

export type FeatureVideoInput = z.input<typeof featureVideoInputSchema>
export type FeatureVideoOutput = z.output<typeof featureVideoOutputSchema>

export function executeFeatureVideo(
  input: FeatureVideoInput,
): FeatureVideoOutput {
  const parsed = featureVideoInputSchema.parse(input)
  return { videoId: parsed.videoId }
}

export const featureVideoTool = createTool({
  id: FEATURE_VIDEO_TOOL_NAME,
  description:
    "Declare which ONE searchVideos result you are featuring in this reply. Call it with that result's videoId, before you write the reply. Featuring is a declaration, not a lookup: only an id from this turn's searchVideos results can be shown, and calling it never adds anything to your text — you still write the reply yourself.",
  inputSchema: featureVideoInputSchema,
  outputSchema: featureVideoOutputSchema,
  execute: async (inputData) => executeFeatureVideo(inputData),
})
