// Safely parse JSON from LLM responses with Zod validation.
// Falls back to the provided default if parsing or validation fails.

import type { ZodType } from "zod"

export function parseLLMJson<T>(
  content: string,
  schema: ZodType<T>,
  fallback: T,
  context?: string,
): T {
  try {
    const parsed: unknown = JSON.parse(content)
    const result = schema.safeParse(parsed)
    if (!result.success) {
      console.warn(
        JSON.stringify({
          event: "llm_json_validation_failed",
          context,
          errors: result.error.issues,
        }),
      )
      return fallback
    }
    return result.data
  } catch {
    console.warn(
      JSON.stringify({
        event: "llm_json_parse_failed",
        context,
        contentSnippet: content.slice(0, 200),
      }),
    )
    return fallback
  }
}
