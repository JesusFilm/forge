// Safely parse JSON from LLM responses with Zod validation.
// Falls back to the provided default if parsing or validation fails.

import type { ZodType } from "zod"

export function parseLLMJson<T>(
  content: string,
  schema: ZodType<T>,
  fallback: T,
): T {
  try {
    const parsed: unknown = JSON.parse(content)
    const result = schema.safeParse(parsed)
    return result.success ? result.data : fallback
  } catch {
    return fallback
  }
}
