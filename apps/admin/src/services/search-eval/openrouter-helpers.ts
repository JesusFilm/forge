/**
 * Shared low-level helpers for OpenRouter chat-completions calls used
 * by the eval harness. judge.ts and query-generator.ts both walk the
 * same `payload.choices[0].message.content` shape and read the same
 * `usage` object — extracting them avoids byte-identical duplication
 * and gives one place to update if OpenRouter's response shape ever
 * shifts.
 *
 * No retry / backoff / fail-over policy lives here — the calibration
 * vs synthetic-query latency budgets are deliberately different, so
 * each caller layers its own retry on top of these primitives.
 */

/**
 * Walk `payload.choices[0].message.content` to a flat text string.
 * Tolerant of both string-content and array-of-parts-with-text shapes
 * that OpenRouter emits depending on the underlying model.
 */
export function extractMessageContent(payload: unknown): string | null {
  if (payload == null || typeof payload !== "object") return null
  const choices = (payload as Record<string, unknown>).choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const message = (choices[0] as Record<string, unknown>).message
  if (message == null || typeof message !== "object") return null
  const content = (message as Record<string, unknown>).content
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part == null || typeof part !== "object") continue
      const text = (part as Record<string, unknown>).text
      if (typeof text === "string") return text
    }
  }
  return null
}

/**
 * OpenRouter sometimes emits `prompt_tokens`/`completion_tokens` and
 * sometimes `input_tokens`/`output_tokens` depending on the model.
 * Both forms map to the same in/out totals.
 */
export function extractTokenCounts(payload: unknown): {
  input: number
  output: number
} {
  if (payload == null || typeof payload !== "object") {
    return { input: 0, output: 0 }
  }
  const usage = (payload as Record<string, unknown>).usage
  if (usage == null || typeof usage !== "object") {
    return { input: 0, output: 0 }
  }
  const u = usage as Record<string, unknown>
  return {
    input:
      typeof u.prompt_tokens === "number"
        ? u.prompt_tokens
        : typeof u.input_tokens === "number"
          ? u.input_tokens
          : 0,
    output:
      typeof u.completion_tokens === "number"
        ? u.completion_tokens
        : typeof u.output_tokens === "number"
          ? u.output_tokens
          : 0,
  }
}

/** Best-effort body read for diagnostic errors. Bounded to 1KB. */
export async function safeReadBody(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 1000)
  } catch {
    return `(unreadable body, status=${response.status})`
  }
}
