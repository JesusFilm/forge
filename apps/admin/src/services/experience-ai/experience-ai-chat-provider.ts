/**
 * Shared `ChatProvider` discriminator for the Experience AI chat surface.
 *
 * The editor picks a provider channel ("openrouter" or "ollama") from the
 * chat composer; the choice flows through the SSE route and into
 * `streamChatTurn`, which branches the quality-draft path and the
 * chat-turn path on the same value. Centralizing the type here prevents
 * literal drift across UI, route, service, and provider adapters.
 */

export type ChatProvider = "openrouter" | "ollama"

export const DEFAULT_CHAT_PROVIDER: ChatProvider = "openrouter"

const KNOWN_PROVIDERS: readonly ChatProvider[] = ["openrouter", "ollama"]

export type NormalizeChatProviderLogger = {
  warn: (message: string, meta?: Record<string, unknown>) => void
}

/**
 * Coerce arbitrary input (request body, URL param, dropdown value) into a
 * closed `ChatProvider` literal. Unknown / missing values default to
 * `DEFAULT_CHAT_PROVIDER` and emit a single sanitized warning so client-side
 * drift is observable without breaking the request.
 *
 * Sanitization: trims, lowercases, strips CR/LF/TAB, clamps to 64 chars to
 * prevent log-injection from a hostile client (mirrors the hybrid-search
 * `normalizeMode` discipline).
 */
export function normalizeChatProvider(
  raw: unknown,
  logger?: NormalizeChatProviderLogger,
): ChatProvider {
  if (raw == null) return DEFAULT_CHAT_PROVIDER
  if (typeof raw !== "string") return DEFAULT_CHAT_PROVIDER

  const normalized = raw.replace(/[\r\n\t]/g, "").trim().toLowerCase()
  if (normalized.length === 0) return DEFAULT_CHAT_PROVIDER

  if ((KNOWN_PROVIDERS as readonly string[]).includes(normalized)) {
    return normalized as ChatProvider
  }

  const safeForLog = normalized.slice(0, 64)
  logger?.warn(
    `[experience-chat] event=unknown_chat_provider value=${safeForLog} falling_back=${DEFAULT_CHAT_PROVIDER}`,
    { value: safeForLog },
  )
  return DEFAULT_CHAT_PROVIDER
}
