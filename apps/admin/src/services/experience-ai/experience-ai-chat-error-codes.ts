/**
 * Shared `ChatErrorCode` union used by the chat service, the provider
 * adapters (Codex spawn, OpenRouter, Ollama), and the SSE route. Lives in
 * its own file so adapter modules can import it without taking a circular
 * dependency on the chat service.
 */

export type ChatErrorCode =
  | "codex_unavailable"
  | "codex_timeout"
  | "codex_idle_timeout"
  | "provider_not_configured"
  | "provider_unavailable"
  | "provider_rate_limited"
  | "provider_timeout"
  | "provider_validation_failed"
  | "timeout"
  | "invalid_json"
  | "schema_violation"
  // Retained for wire compatibility with already-deployed clients. The
  // staged Experience write path no longer emits this code.
  | "concurrent_modification"
  | "slug_change_rejected"
  | "cross_locale_unconfirmed"
  | "rate_limited"
  | "forbidden"
  | "locale_not_found"
  | "thread_not_found"
  | "cancelled"
  | "empty_response"
  | "unknown"
