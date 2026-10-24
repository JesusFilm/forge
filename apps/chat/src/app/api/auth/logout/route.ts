/**
 * Sign-out (F2, R6 + feat-240). Clears chat's local session cookie, sets the
 * single-use force-login marker, and 303s home (a GET, so the browser doesn't
 * re-POST). Idempotent when already anonymous. apps/auth's own SSO session is
 * intentionally untouched — instead the marker makes the next sign-in on this
 * browser (within its 30-day life) send prompt=login, so a real login page
 * renders rather than a silent SSO re-auth. Copied from apps/web's pattern;
 * the 30-day divergence from web's 10 minutes is feat-240's Decision Record.
 *
 * POST, not GET: the sign-out control is a form submit (U7), so this isn't a
 * prefetchable/crawlable link.
 */
import { NextResponse } from "next/server"

import { getChatHomeURL } from "@/auth/origins"
import {
  CHAT_FORCE_LOGIN_COOKIE,
  CHAT_SESSION_COOKIE,
  forceLoginCookieOptions,
} from "@/auth/session-cookie"

export const dynamic = "force-dynamic"

export async function POST() {
  const response = NextResponse.redirect(getChatHomeURL(), 303)
  response.cookies.delete(CHAT_SESSION_COOKIE)
  response.cookies.set(CHAT_FORCE_LOGIN_COOKIE, "1", forceLoginCookieOptions())
  return response
}
