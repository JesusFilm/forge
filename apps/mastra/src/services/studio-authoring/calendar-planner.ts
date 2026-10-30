import type { MastraStorage } from "@mastra/core/storage"
import { Agent, type AgentConfig } from "@mastra/core/agent"
import {
  calendarPlannerInputSchema,
  calendarPlanResultSchema,
  parseCalendarSuggestions,
  type CalendarPlannerInput,
  type CalendarPlanResult,
} from "@forge/studio-contracts/calendar"
import { StudioBoundaryError } from "@forge/studio-server"
import {
  StudioInstructions,
  type FrozenStudioInstructions,
} from "./instructions"

export const calendarPlannerDefaults = `Plan titles and themes only for the admitted dates and complete weeks, in the requested language. Use the supplied weekly themes and operator instructions. Do not write scripts, narration, media descriptions, edit operations, renders or publication commands. You have no tools. Preserve existing work by returning only admitted dates, versions and week identities. Suggestions do not select or verify project sources. Return a JSON object with only items and optional weeks. Each item contains date, expectedVersion, title and theme. Each weekly theme contains startDate and theme. Suggest only complete weeks explicitly admitted in weeks; never extend to a neighboring or partially admitted week. No markdown.`
export const calendarSourceDefaults =
  "Planning produces titles and themes only. Source selection happens in the linked project. Never claim generated suggestions are source evidence."

/** Per-run native agent, with no tools, workspace, memory or authoring transport. */
export async function streamCalendarPlan(args: {
  input: CalendarPlannerInput
  frozen: FrozenStudioInstructions
  model: AgentConfig["model"]
  signal: AbortSignal
}) {
  const context = calendarPlannerInputSchema.parse(args.input)
  args.signal.throwIfAborted()
  if (!context.slots.length && !context.weeks?.length)
    return withProvenance([], args.frozen)
  const signal = AbortSignal.any([args.signal, AbortSignal.timeout(60000)])
  const agent = new Agent({
    id: `studio-calendar-${crypto.randomUUID()}`,
    name: "Studio calendar planner",
    instructions: args.frozen.effective,
    model: args.model,
    editor: false,
    tools: {},
  })
  const stream = await agent.stream(JSON.stringify(context), {
    maxSteps: 1,
    maxProcessorRetries: 0,
    modelSettings: { maxOutputTokens: 8192, maxRetries: 0 },
    abortSignal: signal,
  })
  let text = "",
    bytes = 0
  for await (const chunk of stream.fullStream) {
    if (chunk.type === "error" || chunk.type === "tool-call")
      throw new StudioBoundaryError(
        "Calendar planner returned an unsupported operation",
      )
    if (chunk.type === "text-delta") {
      bytes += Buffer.byteLength(chunk.payload.text)
      if (bytes > 98304)
        throw new StudioBoundaryError("Calendar result exceeds its limit")
      text += chunk.payload.text
    }
  }
  signal.throwIfAborted()
  const suggestions = parseCalendarSuggestions(JSON.parse(text), context)
  return withProvenance(suggestions.items, args.frozen, suggestions.weeks)
}
function withProvenance(
  items: CalendarPlanResult["items"],
  frozen: FrozenStudioInstructions,
  weeks?: CalendarPlanResult["weeks"],
) {
  return calendarPlanResultSchema.parse({
    items,
    ...(weeks ? { weeks } : {}),
    instructions: [
      {
        agentVersionId: frozen.agentVersionId,
        blockVersionId: frozen.blockVersionId,
        digest: frozen.digest,
      },
    ],
    effectiveDigest: frozen.digest,
  })
}

/** Same reviewed native storage, distinct planner profile; no separate registry. */
export function createCalendarInstructions(storage: MastraStorage) {
  return new StudioInstructions(storage, {
    agentId: "studio-calendar-planner",
    blockId: "studio-calendar-source-guidance",
    name: "Studio calendar planner",
    defaults: calendarPlannerDefaults,
    sourceDefaults: calendarSourceDefaults,
  })
}
