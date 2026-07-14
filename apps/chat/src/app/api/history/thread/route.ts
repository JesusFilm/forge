/**
 * `POST /api/history/thread` (feat-241): thin App Router wrapper over the
 * testable core in `../history-proxy.ts`. POST-shaped so the conversation id
 * rides the body, never a URL (id confidentiality in access/CDN logs).
 */

import { getCookieValue } from "@/auth/anon-id"
import {
  CHAT_SESSION_COOKIE,
  readChatSessionCookie,
} from "@/auth/session-cookie"
import { resolveSeekerGate } from "@/lib/seeker-gate"

import {
  buildHistoryProxyConfig,
  handleHistoryThreadProxyRequest,
  resolveHistoryResource,
} from "../history-proxy"

export const dynamic = "force-dynamic"

export async function POST(request: Request): Promise<Response> {
  const cookieHeader = request.headers.get("cookie")
  const identity = await readChatSessionCookie(
    getCookieValue(cookieHeader, CHAT_SESSION_COOKIE),
  )
  return handleHistoryThreadProxyRequest({
    readJson: () => request.json(),
    config: buildHistoryProxyConfig(),
    resolveGate: () => resolveSeekerGate(identity, { surface: "history" }),
    resolveResource: () => resolveHistoryResource(identity),
    requestSignal: request.signal,
  })
}
