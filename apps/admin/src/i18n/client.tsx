"use client"

import { createContext, useContext, type PropsWithChildren } from "react"
import type { AdminLocale, AdminMessages } from "@/i18n/messages"

const AdminI18nContext = createContext<{
  locale: AdminLocale
  messages: AdminMessages
} | null>(null)

export function AdminI18nProvider({
  locale,
  messages,
  children,
}: PropsWithChildren<{
  locale: AdminLocale
  messages: AdminMessages
}>) {
  return (
    <AdminI18nContext.Provider value={{ locale, messages }}>
      {children}
    </AdminI18nContext.Provider>
  )
}

export function useAdminI18n() {
  const value = useContext(AdminI18nContext)

  if (!value) {
    throw new Error("useAdminI18n must be used within AdminI18nProvider")
  }

  return value
}
