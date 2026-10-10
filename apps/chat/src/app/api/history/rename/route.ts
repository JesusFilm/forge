/**
 * `POST /api/history/rename` (feat-450): thin App Router wrapper over the
 * testable write core in `../write-proxy.ts`. Reads the session from the raw
 * cookie header, resolves the seeker dogfood gate with surface "history",
 * and forwards the rename to Mastra's write route. POST-shaped so the thread
 * id and title ride the body, never a URL. Never mints an anon cookie.
 */

import { getCookieValue } from "@/auth/anon-id"
import {
  CHAT_SESSION_COOKIE,
  readChatSessionCookie,
} from "@/auth/session-cookie"
import { resolveSeekerGate } from "@/lib/seeker-gate"

import { resolveHistoryResource } from "../history-proxy"
import {
  buildHistoryWriteProxyConfig,
  handleHistoryRenameProxyRequest,
} from "../write-proxy"

export const dynamic = "force-dynamic"

export async function POST(request: Request): Promise<Response> {
  const cookieHeader = request.headers.get("cookie")
  const identity = await readChatSessionCookie(
    getCookieValue(cookieHeader, CHAT_SESSION_COOKIE),
  )
  return handleHistoryRenameProxyRequest({
    readJson: () => request.json(),
    config: buildHistoryWriteProxyConfig(),
    resolveGate: () => resolveSeekerGate(identity, { surface: "history" }),
    resolveResource: () => resolveHistoryResource(identity),
    requestSignal: request.signal,
  })
}
