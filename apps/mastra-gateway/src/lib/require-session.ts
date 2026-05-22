import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import {
  GATEWAY_SESSION_COOKIE,
  readGatewaySessionCookie,
  type GatewaySession,
} from "@/lib/gateway-session"

export async function getGatewaySession() {
  const cookieStore = await cookies()
  return readGatewaySessionCookie(
    cookieStore.get(GATEWAY_SESSION_COOKIE)?.value,
  )
}

export async function requireGatewaySession({
  admin = false,
}: {
  admin?: boolean
} = {}): Promise<GatewaySession> {
  const session = await getGatewaySession()

  if (!session) {
    redirect(`/api/auth/login?returnTo=${admin ? "/admin" : "/studio"}`)
  }

  if (admin && session.role !== "admin") {
    redirect("/studio")
  }

  return session
}
