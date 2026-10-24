/**
 * Shared JesusFilm AI gateway constants.
 *
 * IMPORTANT — this module MUST stay import-free. It is consumed by
 * `providers.ts`, `memory.ts`, `default-chat-agent.ts`, and
 * `specialized-agents.ts`; the agent + memory files are pulled into the
 * Mastra CLI's Rollup bundle, which trips the "Cannot determine intended
 * module format" trap on any module that re-exports a value with a
 * transitive `@ai-sdk/*` (or other top-level-await) import. Holding only
 * plain string literals here keeps the bundle safe — do NOT add imports.
 */

/**
 * JesusFilm AI gateway base URL — OpenAI-compatible wire fronting the
 * self-hosted Qwen models. Stable but overridable per call site via the
 * `AI_GATEWAY_*_BASE_URL` env vars; this is the fallback default.
 */
export const DEFAULT_AI_GATEWAY_CHAT_BASE_URL =
  "https://ai-gateway.jesusfilm.org/v1"

/**
 * Explicit User-Agent on every gateway request. Cloudflare fronts the
 * gateway and 403s requests with a missing/odd UA; a normal descriptive
 * UA sidesteps that block. The AI SDK merges this header into every
 * outbound call.
 */
export const AI_GATEWAY_USER_AGENT =
  "forge-mastra-chat/1.0 (+https://mastra.jesusfilm.org)"
