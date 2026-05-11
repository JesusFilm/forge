/**
 * Per-channel CLI availability gates for the Experience AI chat surface.
 *
 * Codex and Claude Code spawn local binaries — production Railway
 * containers don't ship them. The gates surface this operationally so
 * picking a CLI channel in the wrong env returns
 * `provider_not_configured` rather than a noisy ENOENT.
 *
 * Back-compat: `EXPERIENCE_AI_ALLOW_CODEX_FALLBACK` is the legacy name
 * for the Codex gate. New code reads `EXPERIENCE_AI_ALLOW_CODEX`; when
 * only the legacy var is set, the helper falls back AND emits a
 * one-shot deprecation log so the contributor sees the migration cue.
 */

import { env } from "@/config/env"

type Logger = {
  warn: (message: string) => void
}

let codexLegacyDeprecationWarned = false

function defaultLogger(): Logger {
  return {
    // eslint-disable-next-line no-console -- structured deprecation log
    warn: (message) => console.warn(message),
  }
}

/**
 * True when the Codex CLI provider is opted in for this environment.
 *
 * Precedence: `EXPERIENCE_AI_ALLOW_CODEX` (new) wins; otherwise falls
 * back to `EXPERIENCE_AI_ALLOW_CODEX_FALLBACK` (legacy) with a one-shot
 * deprecation log. Unset / explicitly `false` → returns false.
 */
export function isCodexAllowed(logger: Logger = defaultLogger()): boolean {
  if (env.EXPERIENCE_AI_ALLOW_CODEX !== undefined) {
    return env.EXPERIENCE_AI_ALLOW_CODEX === true
  }
  if (env.EXPERIENCE_AI_ALLOW_CODEX_FALLBACK === true) {
    if (!codexLegacyDeprecationWarned) {
      codexLegacyDeprecationWarned = true
      logger.warn(
        "[experience-chat] event=deprecation_warning var=EXPERIENCE_AI_ALLOW_CODEX_FALLBACK replacement=EXPERIENCE_AI_ALLOW_CODEX message=Rename the env var; the legacy name will be removed in a future release.",
      )
    }
    return true
  }
  return false
}

/**
 * True when the Claude Code CLI provider is opted in for this environment.
 * No legacy name — this is a new var.
 */
export function isClaudeCodeAllowed(): boolean {
  return env.EXPERIENCE_AI_ALLOW_CLAUDE_CODE === true
}

/**
 * Test-only reset. Resets the one-shot deprecation flag so each test
 * can independently assert log-fired-or-not behavior.
 */
export function __resetCliGatesForTest(): void {
  codexLegacyDeprecationWarned = false
}
