import { readSseStream } from "@/lib/sse"
import {
  ApologistError,
  type ApologistMessage,
  type PromptMeta,
} from "./protocol"

const reasons = new Set([
  "denied",
  "unavailable",
  "invalid_request",
  "history_limit",
  "input_limit",
  "timeout",
  "cancelled",
  "generation_failed",
  "output_limit",
])
function failure(value: unknown): ApologistError {
  if (
    value &&
    typeof value === "object" &&
    "reason" in value &&
    typeof value.reason === "string" &&
    reasons.has(value.reason)
  ) {
    return new ApologistError(value.reason as ApologistError["reason"])
  }
  return new ApologistError("generation_failed")
}

/** Consume only Forge's normalized comparison channel; no gateway secrets reach this client. */
export async function requestApologist(
  messages: ApologistMessage[],
  signal: AbortSignal,
  onMeta: (meta: PromptMeta) => void,
  onToken: (text: string) => void,
): Promise<void> {
  const controller = new AbortController()
  const combined = AbortSignal.any([
    signal,
    controller.signal,
    AbortSignal.timeout(100000),
  ])
  try {
    const response = await fetch("/api/apologist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
      signal: combined,
    })
    if (!response.ok) throw failure(await response.json())
    if (!response.body) throw new ApologistError("generation_failed")
    let terminal = false
    let metaSeen = false
    let chars = 0
    await readSseStream(response.body, (event, data) => {
      if (terminal) throw new ApologistError("generation_failed")
      if (
        event === "meta" &&
        data &&
        typeof data === "object" &&
        "source" in data &&
        (data.source === "production" || data.source === "fallback")
      ) {
        if (metaSeen) throw new ApologistError("generation_failed")
        metaSeen = true
        onMeta({
          source: data.source,
          ...("version" in data && typeof data.version === "number"
            ? { version: data.version }
            : {}),
        })
      } else if (
        event === "token" &&
        metaSeen &&
        data &&
        typeof data === "object" &&
        "text" in data &&
        typeof data.text === "string"
      ) {
        chars += data.text.length
        if (chars > 8192) throw new ApologistError("output_limit")
        onToken(data.text)
      } else if (event === "done" && metaSeen) terminal = true
      else if (event === "error") throw failure(data)
      else throw new ApologistError("generation_failed")
    })
    if (!terminal) throw new ApologistError("generation_failed")
  } finally {
    controller.abort()
  }
}
