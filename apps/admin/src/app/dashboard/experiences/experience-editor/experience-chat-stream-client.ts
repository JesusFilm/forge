/**
 * Experience-chat SSE stream client.
 *
 * Pure async-iterable consumer of `POST /api/experience-chat/stream`. The
 * route handler emits frames of the form
 *
 *   event: <type>\n
 *   data:  <json>\n
 *   \n
 *
 * where `data` is the event minus the `type` discriminator (see U2 route).
 * This client buffers across chunk boundaries, parses each complete frame,
 * and yields the reconstructed `ChatStreamEvent` objects. Malformed frames
 * are surfaced as a typed `error("unknown")` event rather than thrown so
 * the panel can render a consistent terminal state.
 */

import type { ChatStreamEvent } from "@/services/experience-ai/experience-ai-chat.service"

export type StreamChatRequestBody = {
  threadId: string
  prompt: string
  confirmedAcrossLocales?: boolean
  confirmedBrief?: boolean
}

export type StreamChatOptions = {
  signal?: AbortSignal
  /**
   * Injected for tests so we can stub `fetch` without touching globalThis.
   */
  fetchImpl?: typeof fetch
  /** Override endpoint (tests). Defaults to the real route. */
  endpoint?: string
}

const DEFAULT_ENDPOINT = "/api/experience-chat/stream"

/**
 * Known SSE event discriminators emitted by the chat service's
 * `ChatStreamEvent` union (see experience-ai-chat.service.ts). Frames
 * carrying any other `event:` type are skipped rather than cast-through,
 * so an unrecognized server event can never masquerade as a valid union
 * member downstream. Keep in lockstep with the service union.
 */
const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set([
  "token_delta",
  "mutation_applied",
  "error",
  "done",
])

/**
 * Open the SSE stream and yield typed events.
 *
 * Throws on non-2xx HTTP responses. Once the body is open, all error
 * conditions surface as `error` events (or end-of-stream).
 */
export async function* openChatStream(
  body: StreamChatRequestBody,
  options: StreamChatOptions = {},
): AsyncIterable<ChatStreamEvent> {
  const fetchImpl = options.fetchImpl ?? fetch
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: options.signal,
  })

  if (!response.ok) {
    yield {
      type: "error",
      code: response.status === 429 ? "rate_limited" : "unknown",
      message: `Stream request failed with status ${response.status}`,
    }
    return
  }

  if (!response.body) {
    yield {
      type: "error",
      code: "unknown",
      message: "Stream response had no body",
    }
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder("utf-8")
  let buffer = ""

  try {
    while (true) {
      // The stream's reader honors the signal that was passed to fetch —
      // an abort surfaces as a rejection from `read()` which we propagate.
      const { value, done } = await reader.read()
      if (done) {
        // Drain any trailing complete frame still in the buffer.
        const trailing = buffer.trim()
        if (trailing.length > 0) {
          for (const event of parseFrames(trailing + "\n\n")) {
            yield event
          }
        }
        return
      }

      buffer += decoder.decode(value, { stream: true })

      // Frames are separated by a blank line. Yield each complete frame.
      let separatorIndex = buffer.indexOf("\n\n")
      while (separatorIndex !== -1) {
        const rawFrame = buffer.slice(0, separatorIndex)
        buffer = buffer.slice(separatorIndex + 2)
        for (const event of parseFrames(rawFrame + "\n\n")) {
          yield event
        }
        separatorIndex = buffer.indexOf("\n\n")
      }
    }
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "AbortError" || error.code === DOMException.ABORT_ERR)
    ) {
      yield {
        type: "error",
        code: "cancelled",
        message: "Stream aborted",
      }
      return
    }
    yield {
      type: "error",
      code: "unknown",
      message: error instanceof Error ? error.message : "stream read failed",
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // ignore — already released or stream cancelled
    }
  }
}

function* parseFrames(rawFrame: string): IterableIterator<ChatStreamEvent> {
  const trimmed = rawFrame.trim()
  if (trimmed.length === 0) return

  let eventType: string | null = null
  const dataLines: string[] = []

  for (const line of trimmed.split("\n")) {
    if (line.startsWith("event:")) {
      eventType = line.slice("event:".length).trim()
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim())
    }
    // Other SSE fields (id, retry, comments) are ignored.
  }

  if (!eventType) {
    yield {
      type: "error",
      code: "unknown",
      message: `Malformed SSE frame: missing event type`,
    }
    return
  }

  const dataPayload = dataLines.join("\n")
  let parsed: Record<string, unknown> = {}
  if (dataPayload.length > 0) {
    try {
      parsed = JSON.parse(dataPayload) as Record<string, unknown>
    } catch {
      yield {
        type: "error",
        code: "unknown",
        message: `Malformed SSE frame: invalid JSON for event "${eventType}"`,
      }
      return
    }
  }

  // Only reconstruct the union member when the discriminator is one the
  // service is known to emit. An unknown `event:` type is skipped (no
  // yield) rather than cast through `as ChatStreamEvent`, which would let
  // a bogus event masquerade as a valid member. The cast below is now
  // sound because the Set membership narrows `eventType` to a real kind.
  if (!KNOWN_EVENT_TYPES.has(eventType)) {
    return
  }
  yield { type: eventType, ...parsed } as ChatStreamEvent
}
