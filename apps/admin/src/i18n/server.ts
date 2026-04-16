import { cookies, headers } from "next/headers"
import {
  adminMessages,
  supportedAdminLocales,
  type AdminLocale,
  type AdminMessages,
} from "@/i18n/messages"

const localeCookieName = "forge-admin-locale"

function isSupportedLocale(value: string | undefined): value is AdminLocale {
  return !!value && supportedAdminLocales.includes(value as AdminLocale)
}

function parseAcceptLanguage(headerValue: string | null): AdminLocale {
  if (!headerValue) {
    return "en"
  }

  const candidates = headerValue
    .split(",")
    .map((part) => part.trim().split(";")[0]?.toLowerCase())

  for (const candidate of candidates) {
    if (isSupportedLocale(candidate)) {
      return candidate
    }

    const base = candidate?.split("-")[0]
    if (isSupportedLocale(base)) {
      return base
    }
  }

  return "en"
}

export async function getAdminLocale(): Promise<AdminLocale> {
  const cookieStore = await cookies()
  const cookieLocale = cookieStore.get(localeCookieName)?.value
  if (isSupportedLocale(cookieLocale)) {
    return cookieLocale
  }

  const headerStore = await headers()
  return parseAcceptLanguage(headerStore.get("accept-language"))
}

export async function getAdminMessages(): Promise<AdminMessages> {
  const locale = await getAdminLocale()
  return adminMessages[locale] as AdminMessages
}

export async function getAdminI18n() {
  const locale = await getAdminLocale()
  return {
    locale,
    messages: adminMessages[locale] as AdminMessages,
  }
}

export { localeCookieName }
