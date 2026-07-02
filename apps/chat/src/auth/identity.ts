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
 * DISPLAY-ONLY: the returned claims exist to render the account row (R4). They
 * MUST NEVER gate authorization or a per-user decision — chat performs no
 * authorization (R7), the session is a display-only snapshot with an 8h TTL and
 * no revocation (KTD5). The first feature that needs the subject as a trusted
 * principal must add revocation + a membership gate FIRST.
 */
export async function getChatIdentity(): Promise<ChatIdentity | null> {
  const cookieStore = await cookies()
  return readChatSessionCookie(cookieStore.get(CHAT_SESSION_COOKIE)?.value)
}
