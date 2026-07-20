import { type Message, type ReplyFailureReason } from "@/lib/conversations"

import { SourcesList } from "./sources-list"

type MessageListProps = {
  messages: Message[]
  // The in-flight assistant message id (from useConversations), or null. The
  // streaming pulse renders against this id rather than re-deriving "not yet
  // finalized" from Message field absence.
  streamingMessageId: string | null
}

// User-facing failure copy, mapped from the reason to R16's buckets (timeout /
// generation failure / config-unavailable / auth / network). Never surfaces the
// raw reason token.
function failureNotice(reason: ReplyFailureReason): string {
  switch (reason) {
    case "timeout":
      return "The response timed out before it finished. Please try again."
    case "generation_failed":
    case "parse_error":
      return "Something went wrong generating a response. Please try again."
    case "model_key_missing":
    case "config_missing":
    case "ssrf_blocked":
      return "Seeker is unavailable right now. Please try again later."
    case "gate_denied":
      // Reaches the UI only on server-persisted conversations (KTD10) — on
      // never-persisted ones the seam still maps the denial to a stub reply.
      // Access-changed copy, deliberately without a sign-in nudge (feat-236).
      return "Your access to Seeker has changed, so this message wasn't answered. This conversation is kept as it was."
    case "auth_failed":
      return "Seeker rejected the request. Please try again later."
    case "invalid_request":
      return "Your message couldn't be sent — it may be too long. Please shorten it and try again."
    case "network_error":
      return "Couldn't reach Seeker. Check your connection and try again."
    case "cancelled":
      return "The response was cancelled."
    case "thread_forbidden":
      return "This conversation can't be continued from here. Please start a new conversation."
    case "thread_limit":
      return "You've reached the conversation limit for now. Please continue in an existing conversation, or try again later."
    default:
      // Exhaustiveness guard: a new ReplyFailureReason without a case here is a
      // compile error, not a silent `undefined` notice at runtime.
      return assertNever(reason)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled ReplyFailureReason: ${String(value)}`)
}

// The engine that produced a turn, always rendered on finalized assistant turns
// (R20) so a Seeker answer is never confusable with a stub one and a conversation
// never mixes unmarked turns.
function EngineMarker({ engine }: { engine: "stub" | "seeker" }) {
  return (
    <span
      data-engine={engine}
      className="text-xs uppercase tracking-wide text-ash"
    >
      {engine === "seeker" ? "Seeker" : "Stub"}
    </span>
  )
}

// The grounding verdict — the signal the dogfood exists to read (R13). Three
// distinct states: grounded+cited, grounded but no passages cited, ungrounded.
function GroundedBadge({
  grounded,
  hasSources,
}: {
  grounded: boolean
  hasSources: boolean
}) {
  if (grounded && hasSources) {
    return (
      <span data-grounded="cited" className="text-xs text-vellum">
        Grounded
      </span>
    )
  }
  if (grounded && !hasSources) {
    return (
      <span data-grounded="no-citations" className="text-xs text-vesper">
        Grounded · no passages cited
      </span>
    )
  }
  return (
    <span data-grounded="ungrounded" className="text-xs text-vesper">
      Ungrounded
    </span>
  )
}

// One assistant turn. Layout order: answer text → metadata row (grounded badge +
// engine marker) → sources. A streaming turn (pre/mid first token) shows the
// pulse and lives in an aria-live region so appended text is announced.
function AssistantTurn({
  message,
  streaming,
}: {
  message: Message
  streaming: boolean
}) {
  if (streaming) {
    return (
      <li
        data-message-id={message.id}
        data-pending="true"
        aria-live="polite"
        aria-atomic="false"
        className="max-w-[560px] text-lg leading-relaxed whitespace-pre-wrap text-linen"
      >
        <span data-message-content>{message.content}</span>
        <span
          aria-hidden="true"
          className="ml-0.5 inline-block h-[1em] w-0.5 translate-y-1 bg-lamplight [animation:vigil-pulse_2s_var(--ease-vigil)_infinite]"
        />
        <span className="sr-only">Replying</span>
      </li>
    )
  }

  return (
    <li
      data-message-id={message.id}
      className="max-w-[560px] text-lg leading-relaxed whitespace-pre-wrap text-linen"
    >
      <span data-message-content>{message.content}</span>
      {message.error ? (
        <div className="mt-2 flex flex-col gap-1">
          <p role="alert" className="text-sm text-vesper">
            {failureNotice(message.error)}
          </p>
          {message.engine ? <EngineMarker engine={message.engine} /> : null}
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-1">
          <div className="flex items-center gap-2">
            {message.engine === "seeker" ? (
              <GroundedBadge
                grounded={message.grounded === true}
                hasSources={(message.sources?.length ?? 0) > 0}
              />
            ) : null}
            {message.engine ? <EngineMarker engine={message.engine} /> : null}
          </div>
          {message.engine === "seeker" ? (
            <SourcesList sources={message.sources ?? []} />
          ) : null}
        </div>
      )}
    </li>
  )
}

/**
 * Renders the conversation. User turns sit in an Embersoot bubble; assistant
 * turns are plain Linen text with their grounding/source/engine metadata. The
 * in-flight assistant turn (matched by `streamingMessageId`) carries the
 * Lamplight pulse cursor.
 */
export function MessageList({
  messages,
  streamingMessageId,
}: MessageListProps) {
  return (
    <ul className="flex flex-col gap-8">
      {messages.map((message) => {
        if (message.role === "user") {
          return (
            <li key={message.id} className="flex justify-end">
              <div
                data-message-content
                className="max-w-[460px] rounded-[12px_12px_4px_12px] bg-embersoot px-[18px] py-3.5 text-base leading-relaxed whitespace-pre-wrap text-linen"
              >
                {message.content}
              </div>
            </li>
          )
        }
        // The streaming turn is the one the hook flagged as in-flight.
        const streaming = message.id === streamingMessageId
        return (
          <AssistantTurn
            key={message.id}
            message={message}
            streaming={streaming}
          />
        )
      })}
    </ul>
  )
}
