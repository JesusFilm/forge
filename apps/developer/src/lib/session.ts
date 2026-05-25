import { headers as nextHeaders } from "next/headers"
import { redirect } from "next/navigation"
import type { Route } from "next"

import {
  DEVELOPER_SESSION_COOKIE,
  readDeveloperSessionCookie,
} from "@/lib/session-cookie"

export async function requireDeveloperSession(returnTo = "/") {
  const session = await readDeveloperSessionCookie(
    readCookie((await nextHeaders()).get("cookie"), DEVELOPER_SESSION_COOKIE),
  )

  if (!session) {
    redirect(
      `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}` as Route,
    )
  }

  return session
}

function readCookie(cookieHeader: string | null, name: string) {
  return cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}
