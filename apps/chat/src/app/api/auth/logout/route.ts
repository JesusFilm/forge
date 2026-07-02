/**
 * Sign-out (F2, R6). Clears chat's local session cookie and 303s home (a GET,
 * so the browser doesn't re-POST). Idempotent when already anonymous.
 * apps/auth's own SSO session is intentionally untouched (matching admin) — a
 * subsequent sign-in may not re-prompt at the provider.
 *
 * POST, not GET: the sign-out control is a form submit (U7), so this isn't a
 * prefetchable/crawlable link.
 */
import { NextResponse } from "next/server"

import { getChatHomeURL } from "@/auth/origins"
import { CHAT_SESSION_COOKIE } from "@/auth/session-cookie"

export const dynamic = "force-dynamic"

export async function POST() {
  const response = NextResponse.redirect(getChatHomeURL(), 303)
  response.cookies.delete(CHAT_SESSION_COOKIE)
  return response
}
