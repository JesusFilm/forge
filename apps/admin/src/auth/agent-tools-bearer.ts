// Narrow bearer-key authentication for the standalone Mastra chat agent's tool
// callbacks (consolidation U7): search-videos / lookup-bible-verse /
// fetch-video-image. Cloned from `mastra-ingest-bearer.ts`. This is a DIFFERENT
// capability than vector ingest or workflow launch — read-only catalog reads on
// behalf of an agent mid-turn — so it gets its own CSV (`ADMIN_AGENT_TOOLS_API_KEYS`)
// and joins the boot-time `assertBearerCsvsDisjoint` invariant in `config/env.ts`.

import { timingSafeEqual } from "node:crypto"

import { env } from "@/config/env"

const BEARER_PREFIX = /^Bearer\s+/i

function parseAllowlist(csv: string | undefined): string[] {
  if (!csv) return []
  return csv
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0)
}

/**
 * Timing-safe bearer check against `ADMIN_AGENT_TOOLS_API_KEYS`. Returns false
 * when the header is absent/malformed, the CSV is unset (no key can match — the
 * `503 config_missing → 401 wrong-bearer` keyring-first deploy posture), or the
 * presented key matches no entry.
 */
export function isValidAgentToolsBearer(authHeader: string | null): boolean {
  if (!authHeader || !BEARER_PREFIX.test(authHeader)) return false
  const presented = authHeader.replace(BEARER_PREFIX, "")
  if (presented.trim().length === 0) return false

  const allowlist = parseAllowlist(env.ADMIN_AGENT_TOOLS_API_KEYS)
  if (allowlist.length === 0) return false

  const presentedBuffer = Buffer.from(presented)
  let matched = false
  for (const key of allowlist) {
    const keyBuffer = Buffer.from(key)
    if (keyBuffer.length !== presentedBuffer.length) continue
    if (timingSafeEqual(presentedBuffer, keyBuffer)) {
      matched = true
    }
  }
  return matched
}
