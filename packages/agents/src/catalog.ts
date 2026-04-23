import { Agent } from "@mastra/core/agent"
import { z } from "zod"
import {
  SHARED_AGENT_DEFINITIONS,
  type SharedAgentDefinition,
} from "./definitions"

const sharedAgentFieldsSchema = z.record(
  z.string().trim().min(1),
  z
    .string()
    .max(20_000)
    .transform((value) => value.trim()),
)

export const sharedAgentRunInputSchema = z.object({
  goal: z.string().trim().min(1).max(4_000),
  supportingContext: z
    .string()
    .trim()
    .max(20_000)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  fields: sharedAgentFieldsSchema.default({}),
})

export type SharedAgentRunInput = z.infer<typeof sharedAgentRunInputSchema>

export type SharedAgentValidationResult =
  | { success: true; data: SharedAgentRunInput }
  | { success: false; errors: string[] }

export function listSharedAgentDefinitions(): SharedAgentDefinition[] {
  return [...SHARED_AGENT_DEFINITIONS]
}

export function getSharedAgentDefinition(
  agentId: string,
): SharedAgentDefinition | null {
  return (
    SHARED_AGENT_DEFINITIONS.find((definition) => definition.id === agentId) ??
    null
  )
}

export function validateSharedAgentRunInput(
  definition: SharedAgentDefinition,
  input: unknown,
): SharedAgentValidationResult {
  const parsed = sharedAgentRunInputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.error.issues.map((issue) => issue.message),
    }
  }

  const errors: string[] = []
  const allowedKeys = new Set(definition.fields.map((field) => field.key))
  const providedKeys = Object.keys(parsed.data.fields)
  const unknownKeys = providedKeys.filter((key) => !allowedKeys.has(key))

  if (unknownKeys.length > 0) {
    errors.push(`Unknown field(s): ${unknownKeys.join(", ")}`)
  }

  for (const field of definition.fields) {
    if (!field.required) continue
    const value = parsed.data.fields[field.key]?.trim()
    if (!value) {
      errors.push(`${field.label} is required.`)
    }
  }

  if (errors.length > 0) {
    return { success: false, errors }
  }

  return { success: true, data: parsed.data }
}

export function buildSharedAgentPrompt(
  definition: SharedAgentDefinition,
  input: SharedAgentRunInput,
): string {
  const sections = [
    `Goal:\n${input.goal}`,
    input.supportingContext
      ? `Supporting context:\n${input.supportingContext}`
      : null,
    ...definition.fields
      .map((field) => {
        const value = input.fields[field.key]
        if (!value) return null
        return `${field.label}:\n${value}`
      })
      .filter((section): section is string => section != null),
  ]

  return sections.join("\n\n")
}

export type SharedAgentModel = ConstructorParameters<typeof Agent>[0]["model"]
export type SharedAgentTools = ConstructorParameters<typeof Agent>[0]["tools"]
export type SharedAgentWorkflows = ConstructorParameters<
  typeof Agent
>[0]["workflows"]
export type SharedAgentMemory = ConstructorParameters<typeof Agent>[0]["memory"]
export type SharedAgentRequestContextSchema = ConstructorParameters<
  typeof Agent
>[0]["requestContextSchema"]
export type SharedAgentDefaultOptions = ConstructorParameters<
  typeof Agent
>[0]["defaultOptions"]

export function createSharedMastraAgent(input: {
  definition: SharedAgentDefinition
  model: SharedAgentModel
  tools?: SharedAgentTools
  workflows?: SharedAgentWorkflows
  memory?: SharedAgentMemory
  requestContextSchema?: SharedAgentRequestContextSchema
  defaultOptions?: SharedAgentDefaultOptions
}) {
  return new Agent({
    id: input.definition.id,
    name: input.definition.name,
    description: input.definition.description,
    instructions: input.definition.instructions,
    model: input.model,
    tools: input.tools,
    workflows: input.workflows,
    memory: input.memory,
    requestContextSchema: input.requestContextSchema,
    defaultOptions: input.defaultOptions,
  })
}
