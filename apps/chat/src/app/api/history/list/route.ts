/**
 * `POST /api/history/list` (feat-241): thin App Router wrapper over the
 * testable core in `../history-proxy.ts`. Reads the session from the raw
 * cookie header, resolves the seeker dogfood gate with surface "history",
 * and forwards to Mastra's listing route. Never mints an anon cookie.
 */

import { getCookieValue } from "@/auth/anon-id"
import {
  CHAT_SESSION_COOKIE,
  readChatSessionCookie,
} from "@/auth/session-cookie"
import { resolveSeekerGate } from "@/lib/seeker-gate"

import {
  buildHistoryProxyConfig,
  handleHistoryListProxyRequest,
  resolveHistoryResource,
} from "../history-proxy"

export const dynamic = "force-dynamic"

export async function POST(request: Request): Promise<Response> {
  const cookieHeader = request.headers.get("cookie")
  const identity = await readChatSessionCookie(
    getCookieValue(cookieHeader, CHAT_SESSION_COOKIE),
  )
  return handleHistoryListProxyRequest({
    readJson: () => request.json(),
    config: buildHistoryProxyConfig(),
    resolveGate: () => resolveSeekerGate(identity, { surface: "history" }),
    resolveResource: () => resolveHistoryResource(identity),
    requestSignal: request.signal,
  })
}
