import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import {
  LEGACY_STRAPI_SESSION_COOKIE,
  MANAGER_SESSION_COOKIE,
} from "@/lib/session-cookie"

export async function POST() {
  const cookieStore = await cookies()
  cookieStore.delete(MANAGER_SESSION_COOKIE)
  cookieStore.delete(LEGACY_STRAPI_SESSION_COOKIE)
  return NextResponse.json({ success: true })
}
