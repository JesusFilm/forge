import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { supportedAdminLocales, type AdminLocale } from "@/i18n/messages"
import { localeCookieName } from "@/i18n/server"

function isSupportedLocale(value: unknown): value is AdminLocale {
  return (
    typeof value === "string" &&
    supportedAdminLocales.includes(value as AdminLocale)
  )
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as {
    locale?: unknown
  } | null

  if (!isSupportedLocale(payload?.locale)) {
    return NextResponse.json({ error: "invalid-locale" }, { status: 400 })
  }

  const cookieStore = await cookies()
  cookieStore.set(localeCookieName, payload.locale, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  })

  return NextResponse.json({ ok: true })
}
