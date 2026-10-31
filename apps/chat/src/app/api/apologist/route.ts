import {
  CHAT_SESSION_COOKIE,
  readChatSessionCookie,
  readRequestCookie,
} from "@/auth/session-cookie"
import { comparisonAllowed } from "@/features/apologist/server/gate"
import { handleApologist } from "@/features/apologist/server/handler"
import { resolveSeekerGate } from "@/lib/seeker-gate"

export const dynamic = "force-dynamic"

/** Recheck signed identity and both gates on every comparison request. */
export async function POST(request: Request): Promise<Response> {
  const identity = await readChatSessionCookie(
    readRequestCookie(request.headers.get("cookie"), CHAT_SESSION_COOKIE),
  )
  const gate = await resolveSeekerGate(identity, { surface: "route" })
  return handleApologist(
    request,
    comparisonAllowed(identity, gate.seekerEnabled),
  )
}
