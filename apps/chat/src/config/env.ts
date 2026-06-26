// Chat's first validated env surface (feat-205): the Seeker enable flag + Mastra
// base URL/bearer/allowlist/timeout. EVERY var is optional so a default-off
// deploy boots clean. Mirrors apps/mastra/src/config/env.ts (zod + string-bool).

import { z } from "zod"

// Railway/Doppler can inject an empty string for an unset var; treat "" as absent
// so optional vars stay truly optional rather than failing a non-empty refinement.
const emptyToUndefined = (value: string | undefined) =>
  value === undefined || value === "" ? undefined : value

const DEFAULT_TIMEOUT_MS = 95000
// The route's 90s chatTurn ceiling. The proxy timeout should sit ABOVE this so a
// route-side timeout relays a clean `timeout` (KTD4). Lowering below it is a
// documented escape hatch (Railway stream cap), so we WARN, never clamp.
const ROUTE_CEILING_MS = 90000

const envSchema = z.object({
  // string-boolean (repo convention): only the literal "true" enables Seeker.
  SEEKER_CHAT_ENABLED: z.string().optional(),
  SEEKER_MASTRA_BASE_URL: z.string().optional(),
  SEEKER_MASTRA_API_KEY: z.string().optional(),
  // CSV SSRF allowlist; unset → operator-set base host trusted (redirect:"error"
  // still guards). Matches admin's hostAllowed.
  SEEKER_MASTRA_ALLOWED_HOSTS: z.string().optional(),
  // Kept as a raw string here (NOT z.coerce.number): a non-numeric value must
  // NOT crash envSchema.parse() at module load — that would break the
  // "every var optional, boots clean" guarantee. seekerTimeoutMs() does the
  // tolerant numeric parse + positivity guard + fallback.
  SEEKER_TIMEOUT_MS: z.string().optional(),
})

export const env = envSchema.parse({
  SEEKER_CHAT_ENABLED: emptyToUndefined(process.env.SEEKER_CHAT_ENABLED),
  SEEKER_MASTRA_BASE_URL: emptyToUndefined(process.env.SEEKER_MASTRA_BASE_URL),
  SEEKER_MASTRA_API_KEY: emptyToUndefined(process.env.SEEKER_MASTRA_API_KEY),
  SEEKER_MASTRA_ALLOWED_HOSTS: emptyToUndefined(
    process.env.SEEKER_MASTRA_ALLOWED_HOSTS,
  ),
  SEEKER_TIMEOUT_MS: emptyToUndefined(process.env.SEEKER_TIMEOUT_MS),
})

// Surface a sub-ceiling timeout at module load — silent misconfig would make the
// proxy abort before the route's 90s frame, mislabeling every turn (KTD4). The
// value is still honored (lowering is a documented escape hatch); this is a warning.
{
  const parsed = Number(env.SEEKER_TIMEOUT_MS)
  if (
    env.SEEKER_TIMEOUT_MS !== undefined &&
    Number.isFinite(parsed) &&
    parsed > 0 &&
    parsed < ROUTE_CEILING_MS
  ) {
    console.warn(
      `[seeker-chat] event=timeout_below_route_ceiling configured_ms=${parsed} ceiling_ms=${ROUTE_CEILING_MS}`,
    )
  }
}

/** Whether the chat app should route messages to Seeker (vs the local stub). */
export function isSeekerChatEnabled(): boolean {
  return env.SEEKER_CHAT_ENABLED === "true"
}

/**
 * The outbound proxy→Mastra timeout in ms. Tolerant: a non-numeric, zero, or
 * negative `SEEKER_TIMEOUT_MS` falls back to the documented default rather than
 * crashing boot or making `AbortSignal.timeout` fire instantly (every turn
 * would time out). Must stay > the route's 90s ceiling (see plan KTD4).
 */
export function seekerTimeoutMs(): number {
  const parsed = Number(env.SEEKER_TIMEOUT_MS)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS
}
