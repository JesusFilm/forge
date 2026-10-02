export type ApologistMessage = { role: "user" | "assistant"; content: string }
export type PromptMeta = { source: "production" | "fallback"; version?: number }
export type FailureReason =
  | "denied"
  | "unavailable"
  | "invalid_request"
  | "history_limit"
  | "input_limit"
  | "timeout"
  | "cancelled"
  | "generation_failed"
  | "output_limit"

/** Closed, content-free failure shared by the isolated transport and pane. */
export class ApologistError extends Error {
  constructor(public readonly reason: FailureReason) {
    super(reason)
    this.name = "ApologistError"
  }
}

/** Validate the complete comparison history without accepting provider overrides. */
export function validateHistory(value: unknown): ApologistMessage[] {
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).join() !== "messages" ||
    !("messages" in value) ||
    !Array.isArray(value.messages)
  )
    throw new ApologistError("invalid_request")
  if (value.messages.length > 40) throw new ApologistError("history_limit")
  if (!value.messages.length) throw new ApologistError("invalid_request")
  let total = 0
  const messages = value.messages.map((message: unknown): ApologistMessage => {
    if (
      !message ||
      typeof message !== "object" ||
      !("role" in message) ||
      !("content" in message) ||
      Object.keys(message).length !== 2 ||
      (message.role !== "user" && message.role !== "assistant") ||
      typeof message.content !== "string" ||
      !message.content.trim()
    )
      throw new ApologistError("invalid_request")
    if (message.content.length > 4000) throw new ApologistError("input_limit")
    total += message.content.length
    return { role: message.role, content: message.content }
  })
  if (total > 40000) throw new ApologistError("history_limit")
  if (messages.at(-1)?.role !== "user")
    throw new ApologistError("invalid_request")
  return messages
}
