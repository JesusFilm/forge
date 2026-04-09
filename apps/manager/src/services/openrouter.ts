// Shared OpenRouter client — all AI services import from here.
// Uses the openai SDK with OpenRouter's base URL.

import OpenAI from "openai"
import { z } from "zod"
import { env } from "@/config/env"

let _openrouter: OpenAI | undefined
export function getOpenrouter(): OpenAI {
  if (!_openrouter) {
    _openrouter = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: env.OPENROUTER_API_KEY,
      timeout: 120_000,
      maxRetries: 3,
    })
  }
  return _openrouter
}

export const DEFAULT_MODEL = "google/gemini-2.5-flash"

type StructuredOutputMessage = {
  role: "system" | "user" | "assistant"
  content: string
}

type StructuredOutputOptions<T> = {
  context: string
  name: string
  schema: z.ZodType<T>
  jsonSchema: OpenAI.ResponseFormatJSONSchema["json_schema"]["schema"]
  messages: StructuredOutputMessage[]
  model?: string
}

function parseStructuredJsonContent<T>(
  content: string,
  schema: z.ZodType<T>,
  context: string,
): T {
  let parsed: unknown

  try {
    parsed = JSON.parse(content)
  } catch {
    console.warn(
      JSON.stringify({
        event: "structured_output_parse_failed",
        context,
        contentSnippet: content.slice(0, 200),
      }),
    )
    throw new Error(`Structured output parsing failed for ${context}`)
  }

  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      console.warn(
        JSON.stringify({
          event: "structured_output_double_parse_failed",
          context,
          contentSnippet: content.slice(0, 200),
        }),
      )
      throw new Error(`Structured output parsing failed for ${context}`)
    }
  }

  const result = schema.safeParse(parsed)
  if (!result.success) {
    console.warn(
      JSON.stringify({
        event: "structured_output_validation_failed",
        context,
        errors: result.error.issues,
      }),
    )
    throw new Error(`Structured output validation failed for ${context}`)
  }

  return result.data
}

export async function createStructuredOpenrouterOutput<T>({
  context,
  name,
  schema,
  jsonSchema,
  messages,
  model = DEFAULT_MODEL,
}: StructuredOutputOptions<T>): Promise<T> {
  const response = await getOpenrouter().chat.completions.create({
    model,
    messages,
    response_format: {
      type: "json_schema",
      json_schema: {
        name,
        strict: true,
        schema: jsonSchema,
      },
    },
    plugins: [{ id: "response-healing" }],
  } as OpenAI.ChatCompletionCreateParamsNonStreaming)

  const message = response.choices[0]?.message
  if (message?.refusal) {
    throw new Error(`Structured output request refused for ${context}`)
  }

  if (
    typeof message?.content !== "string" ||
    message.content.trim().length === 0
  ) {
    throw new Error(`Structured output missing content for ${context}`)
  }

  return parseStructuredJsonContent(message.content, schema, context)
}
