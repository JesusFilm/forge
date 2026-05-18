/**
 * Streaming bridge — Mastra UIMessageStream → ChatStreamEvent (U3).
 *
 * Translates an `AsyncIterable<MastraStreamPart>` into the canonical
 * `AsyncIterable<ChatStreamEvent>` the editor panel renders. This is
 * the load-bearing seam of the chat-replacement plan: every panel-side
 * rendering path depends on this union staying byte-stable.
 *
 * Why a custom part type instead of Mastra's UIMessage shape directly:
 * - Mastra's wire shape is in flux across versions (V1/V2/V3 of the AI
 *   SDK's LanguageModel interface). Pinning to a normalised internal
 *   `MastraStreamPart` lets U6's chat service convert once (where
 *   we control the version coupling) and call this bridge with a
 *   shape the bridge tests can mock cheaply.
 * - The bridge's job is contract preservation, not provider
 *   abstraction — by the time a part reaches here it's already
 *   provider-normalised by the surrounding chat service.
 *
 * Error classification (R12 + plan C7): the bridge maps thrown errors
 * to closed `ChatErrorCode` values. Unknown errors fall back to
 * `"unknown"`; named errors (`ProviderNotConfiguredError`, `AbortError`,
 * etc.) classify by `error.name` first. This mirrors the
 * AWS-NoSuchKey discipline from
 * `docs/solutions/runtime-errors/aws-s3-nosuchkey-classification-pattern-20260506.md`
 * — typed error name > error code > message regex.
 */

import type {
  ChatErrorCode,
  ChatStreamEvent,
  ExperienceChatDiff,
} from "./chat-stream-event"

// ---------------------------------------------------------------------------
// Stream-part union (the bridge's input contract)
// ---------------------------------------------------------------------------

export type MastraStreamPart =
  | { kind: "text-delta"; text: string }
  | {
      kind: "tool-call"
      toolId: string
      callId: string
    }
  | {
      kind: "tool-result"
      toolId: string
      callId: string
      durationMs: number
    }
  | {
      kind: "finish"
      messageId: string
      /**
       * Structured output the agent produced. When present and shaped
       * like `{ diff: ExperienceChatDiff }`, the bridge emits a
       * `mutation_applied` event before `done`. Otherwise a malformed
       * envelope becomes an `error` event (validation_failed).
       */
      envelope?: unknown
    }

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

function classifyError(error: unknown): ChatErrorCode {
  if (!(error instanceof Error)) return "unknown"
  // Match the typed surface first (per institutional learning on
  // AWS-NoSuchKey-style classification).
  switch (error.name) {
    case "ProviderNotConfiguredError":
      return "provider_not_configured"
    case "AbortError":
    case "TimeoutError":
      return "timeout"
    case "ZodError":
    case "ValidationError":
      return "validation_failed"
    case "AgentNotFoundError":
      return "agent_not_found"
    case "ToolExecutionError":
      return "tool_failed"
    default:
      return "unknown"
  }
}

// ---------------------------------------------------------------------------
// Envelope validation
// ---------------------------------------------------------------------------

function extractDiffFromEnvelope(envelope: unknown): ExperienceChatDiff | null {
  if (envelope === null || typeof envelope !== "object") return null
  const record = envelope as Record<string, unknown>
  const diff = record.diff
  if (diff === null || typeof diff !== "object") return null
  const diffRecord = diff as Record<string, unknown>
  // Minimum shape: must have a `scalars` object. `blocks` is optional.
  if (typeof diffRecord.scalars !== "object" || diffRecord.scalars === null) {
    return null
  }
  // Trust the rest of the shape — full Zod validation belongs at the
  // chat-service boundary (U6), not at the streaming bridge. The
  // bridge's contract is "diff has the right structural skeleton."
  return diff as ExperienceChatDiff
}

// ---------------------------------------------------------------------------
// Bridge — the public API
// ---------------------------------------------------------------------------

/**
 * Adapt a Mastra-shaped stream into the canonical `ChatStreamEvent`
 * union. Stream errors are caught and yielded as `error` events; the
 * iterator does NOT throw to the consumer.
 */
export async function* adaptMastraStream(
  source: AsyncIterable<MastraStreamPart>,
): AsyncIterable<ChatStreamEvent> {
  try {
    for await (const part of source) {
      switch (part.kind) {
        case "text-delta":
          yield { type: "token_delta", text: part.text }
          break

        case "tool-call":
          yield {
            type: "tool_call_started",
            toolId: part.toolId,
            callId: part.callId,
          }
          break

        case "tool-result":
          yield {
            type: "tool_call_completed",
            toolId: part.toolId,
            callId: part.callId,
            durationMs: part.durationMs,
          }
          break

        case "finish": {
          if (part.envelope !== undefined) {
            const diff = extractDiffFromEnvelope(part.envelope)
            if (diff === null) {
              yield {
                type: "error",
                code: "validation_failed",
                message:
                  "Agent envelope is malformed: expected `{ diff: { scalars, blocks? } }`.",
              }
              return
            }
            yield {
              type: "mutation_applied",
              messageId: part.messageId,
              diff,
            }
          }
          yield { type: "done", messageId: part.messageId }
          return
        }

        default: {
          const exhaustive: never = part
          void exhaustive
        }
      }
    }
  } catch (error) {
    yield {
      type: "error",
      code: classifyError(error),
      message: error instanceof Error ? error.message : "Unknown stream error",
    }
  }
}
