import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { getCmsGateway } from "@/cms/gateway"
import { MANAGER_SESSION_COOKIE } from "@/lib/session-cookie"

export async function POST() {
  const cookieStore = await cookies()
  const sessionToken = cookieStore.get(MANAGER_SESSION_COOKIE)?.value
  if (sessionToken) {
    await getCmsGateway().logoutManagerSession(sessionToken)
  }
  cookieStore.delete(MANAGER_SESSION_COOKIE)
  return NextResponse.json({ success: true })
}
