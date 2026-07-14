import { cookies } from "next/headers"

import {
  CHAT_SESSION_COOKIE,
  type ChatIdentity,
  readChatSessionCookie,
} from "./session-cookie"

/**
 * Read the signed-in user's verified identity claims from the session cookie,
 * or null when anonymous (F1 read-side, R5). NEVER redirects — anonymous is a
 * valid, first-class state (R3), deliberately unlike admin's `requireSession()`.
 *
 * DISPLAY-ONLY, with ONE bounded carve-out (R13, feat-233): the claims render
 * the account row (R4), and the seeker dogfood gate may consume them for
 * named-person feature gating via the SEEKER_ALLOWED_EMAILS env allowlist —
 * internal staff dogfooders only (see src/lib/seeker-gate.ts). Beyond that
 * they MUST NEVER gate authorization or a per-user decision — the session is
 * a snapshot with an 8h TTL (KTD5), so rule-based gating, allowlist entries
 * outside the org, or reuse beyond seeker dogfooding requires a membership
 * gate FIRST. Revocation is deliberately NOT required (feat-240 Decision
 * Record — accepted for an 8h cookie scoped to self-reads; revisit if the
 * session gets longer or the cookie starts gating more than that).
 */
export async function getChatIdentity(): Promise<ChatIdentity | null> {
  const cookieStore = await cookies()
  return readChatSessionCookie(cookieStore.get(CHAT_SESSION_COOKIE)?.value)
}
