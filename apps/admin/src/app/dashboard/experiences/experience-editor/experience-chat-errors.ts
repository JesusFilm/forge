/**
 * Typed presentation map for chat stream error codes.
 *
 * The service layer (experience-ai-chat.service) emits a closed
 * `ChatErrorCode` union on every error event. The chat panel must NEVER
 * surface a raw `error.message` from the wire — those strings can leak
 * internals (stack traces, upstream provider phrasing, schema paths).
 *
 * This module is the single seam where codes become user-facing copy and
 * recovery affordances. Adding a new code to the union without an entry
 * here is caught by the test suite (and TypeScript, since the map is
 * keyed on the union).
 */
import type { ChatErrorCode } from "@/services/experience-ai/experience-ai-chat.service"

export type ChatErrorPresentation = {
  /** 2–5 word title, sentence case. Rendered as a small mono uppercase label. */
  title: string
  /** 1–2 sentence user-facing message with a recovery hint. */
  message: string
  /** Whether the panel should show a "Try again" affordance. */
  retry: boolean
  /** Visual severity. `warn` = expected boundary condition; `error` = crash. */
  severity: "warn" | "error"
}

export const CHAT_ERROR_PRESENTATION: Readonly<
  Record<ChatErrorCode, ChatErrorPresentation>
> = {
  codex_unavailable: {
    title: "AI unreachable",
    message: "The AI service is not responding. Try again in a minute.",
    retry: true,
    severity: "error",
  },
  codex_timeout: {
    title: "Took too long",
    message: "The AI took longer than expected. Try a shorter prompt.",
    retry: true,
    severity: "error",
  },
  codex_idle_timeout: {
    title: "Connection stalled",
    message: "The AI stopped responding mid-stream. Try again.",
    retry: true,
    severity: "error",
  },
  provider_not_configured: {
    title: "AI not configured",
    message:
      "The selected AI provider isn't configured for this environment. Try a different channel from the dropdown.",
    retry: false,
    severity: "error",
  },
  provider_unavailable: {
    title: "AI unavailable",
    message:
      "The selected AI provider is unavailable right now. Try again or switch channels.",
    retry: true,
    severity: "error",
  },
  provider_rate_limited: {
    title: "AI rate limited",
    message:
      "The selected AI provider is rate-limited right now. Try again later or switch channels.",
    retry: true,
    severity: "error",
  },
  provider_timeout: {
    title: "Took too long",
    message:
      "The selected AI provider took too long. Try again or switch channels.",
    retry: true,
    severity: "error",
  },
  provider_validation_failed: {
    title: "Draft rejected",
    message: "The generated draft did not pass validation. Try again.",
    retry: true,
    severity: "error",
  },
  timeout: {
    title: "Took too long",
    message:
      "The AI took longer than expected and the request timed out. Try again or use a shorter prompt.",
    retry: true,
    severity: "error",
  },
  invalid_json: {
    title: "Garbled response",
    message: "The AI's response couldn't be parsed. Try rephrasing.",
    retry: true,
    severity: "error",
  },
  schema_violation: {
    title: "Invalid change",
    message: "The AI proposed a change we can't apply. Try rephrasing.",
    retry: true,
    severity: "error",
  },
  concurrent_modification: {
    title: "Page changed",
    message:
      "This page was edited elsewhere while the AI was working. Reload to get the latest version, then try again.",
    retry: true,
    severity: "warn",
  },
  slug_change_rejected: {
    title: "Slug is locked",
    message:
      "The AI tried to change the URL slug. The slug is owned by editors and can't be changed by chat.",
    retry: false,
    severity: "warn",
  },
  cross_locale_unconfirmed: {
    title: "Confirm cross-locale",
    message:
      "This change affects other locales. Toggle the cross-locale option and try again.",
    retry: false,
    severity: "warn",
  },
  rate_limited: {
    title: "Too many requests",
    message: "You're sending requests too fast. Wait a minute and try again.",
    retry: true,
    severity: "error",
  },
  forbidden: {
    title: "No permission",
    message: "You don't have edit permission on this experience.",
    retry: false,
    severity: "error",
  },
  locale_not_found: {
    title: "Locale missing",
    message: "This locale no longer exists. Reload the page.",
    retry: false,
    severity: "error",
  },
  thread_not_found: {
    title: "Conversation gone",
    message: "This conversation was deleted. Start a new one.",
    retry: false,
    severity: "error",
  },
  cancelled: {
    title: "Stopped",
    message: "You stopped the response.",
    retry: false,
    severity: "warn",
  },
  empty_response: {
    title: "No response",
    message: "The AI returned nothing. Try again.",
    retry: true,
    severity: "error",
  },
  unknown: {
    title: "Something went wrong",
    message: "An unexpected error occurred. Try again.",
    retry: true,
    severity: "error",
  },
}

/**
 * Look up the presentation for a code. Defensive: accepts any string so
 * a future server-side code we don't recognize falls back to `unknown`
 * rather than crashing the panel.
 */
export function presentChatError(
  code: ChatErrorCode | string,
): ChatErrorPresentation {
  return (
    (CHAT_ERROR_PRESENTATION as Record<string, ChatErrorPresentation>)[code] ??
    CHAT_ERROR_PRESENTATION.unknown
  )
}
