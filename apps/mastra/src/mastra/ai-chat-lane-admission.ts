/**
 * ai-chat lane admission preamble (feat-283) — the ONE implementation of the
 * two rungs every lane route shares, in order: enable flag
 * (`SEEKER_ROUTE_ENABLED`) → 404 `{ error: "Not found" }`, then lane bearer
 * (`AI_CHAT_SERVICE_API_KEYS`) → 401 `{ error: "Service bearer required" }`.
 * The refusal order and both bodies are a frozen wire contract with
 * `apps/chat` — never reorder or reword them.
 *
 * Key sourcing lives INSIDE this module (KTD2's handler-owned sourcing,
 * generalized): the default reads the DEDICATED lane CSV, never the shared
 * `MASTRA_SERVICE_API_KEYS` pool, so a route registration cannot accidentally
 * wire pool keys into conversation data (feat-250's hard cutover). An unset
 * lane CSV is an empty allowlist — every bearer refused until provisioned
 * (fail closed). `assertAiChatServiceKeysDisjoint` (config/env.ts) refuses
 * boot when a key value appears in both CSVs.
 *
 * The pool-vs-lane invariant is guarded by the discriminating key-source test
 * in `ai-chat-lane-admission.test.ts` (both CSVs set to distinct values;
 * pool key → 401, lane key → admitted through the DEFAULT source) — the
 * structural successor to feat-250's `seeker-route-isolation.test.ts` source
 * pins. Editing `readLaneServiceKeys` to the pool CSV turns that test red.
 *
 * The `getEnabled` / `getServiceKeys` seams exist for tests only; production
 * callers (the seeker send + history list/replay handlers) pass `authHeader`
 * alone. Everything past admission — body validation, the `user:`-prefix 403,
 * budget→reason mapping — deliberately stays per-route (Ruling 1, req 2).
 */

import {
  isValidServiceBearer,
  parseServiceApiKeys,
} from "../server/service-bearer"
import { env, isSeekerRouteEnabled } from "../config/env"

/** A lane refusal as it reaches the wire: 404 before 401, fixed bodies. */
export type AiChatLaneRefusal = {
  status: 404 | 401
  body: { error: string }
}

/** The default lane-key source: the dedicated CSV, never the pool (KTD2). */
export function readLaneServiceKeys(): readonly string[] {
  return parseServiceApiKeys(env.AI_CHAT_SERVICE_API_KEYS)
}

/**
 * Flag + bearer preamble shared by every ai-chat lane handler. Returns the
 * refusal, or null when admitted. Flag first (404 — the lane is unreachable
 * unless enabled, before the bearer is even consulted), then the lane bearer
 * (401).
 */
export function refuseUnlessLaneAdmitted({
  authHeader,
  getEnabled = isSeekerRouteEnabled,
  getServiceKeys = readLaneServiceKeys,
}: {
  authHeader: string | null | undefined
  getEnabled?: () => boolean
  getServiceKeys?: () => readonly string[]
}): AiChatLaneRefusal | null {
  if (!getEnabled()) {
    return { status: 404, body: { error: "Not found" } }
  }
  if (!isValidServiceBearer({ authHeader, allowlist: getServiceKeys() })) {
    return { status: 401, body: { error: "Service bearer required" } }
  }
  return null
}
