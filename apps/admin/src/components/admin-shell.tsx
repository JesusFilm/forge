"use client"

import type { Route } from "next"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Command, Globe, HelpCircle, Search, Sparkles } from "lucide-react"
import {
  adminNavItems,
  adminNavSections,
  getNavItem,
} from "@/components/admin-nav"
import { useAdminI18n } from "@/i18n/client"
import { supportedAdminLocales } from "@/i18n/messages"
import {
  BreadcrumbTrail,
  InfoStrip,
  SearchPillButton,
  cx,
} from "@/components/admin-ui"

type PrincipalView = {
  id: string | null
  role: string
}

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") {
    return pathname === href
  }
  return pathname.startsWith(href)
}

function initialsFromPrincipal(principal: PrincipalView) {
  const source = principal.id ?? principal.role
  const letters = source
    .replace(/[^a-zA-Z]/g, "")
    .slice(0, 2)
    .toUpperCase()
  return letters || "FA"
}

export function AdminShell({
  principal,
  children,
}: {
  principal: PrincipalView
  children: ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const { locale, messages } = useAdminI18n()
  const [isPaletteOpen, setPaletteOpen] = useState(false)
  const [isSwitchingLocale, setIsSwitchingLocale] = useState(false)
  const activeItem = getNavItem(pathname)

  const quickLinks = useMemo(
    () => adminNavItems.filter((item) => item.href !== pathname).slice(0, 6),
    [pathname],
  )

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setPaletteOpen((current) => !current)
      }

      if (event.key === "Escape") {
        setPaletteOpen(false)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  async function handleLocaleChange(nextLocale: string) {
    if (nextLocale === locale) {
      return
    }

    setIsSwitchingLocale(true)
    try {
      await fetch("/api/preferences/locale", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locale: nextLocale }),
      })
      router.refresh()
    } finally {
      setIsSwitchingLocale(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-[var(--color-bg)] text-[var(--color-text-primary)]">
      <aside className="fixed inset-y-0 left-0 z-40 flex w-[240px] flex-col border-r border-[var(--color-hairline)] bg-[var(--color-surface)]">
        <div className="px-6 py-4">
          <div className="text-lg font-semibold tracking-[-0.02em]">
            {messages.common.shell.brandName}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
            {messages.common.shell.brandTag}
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {adminNavSections.map((section) => (
            <div key={section.label} className="mb-5">
              <div className="label-text px-3 pb-2">
                {messages.nav.sections[section.label]}
              </div>
              <div className="space-y-1">
                {section.items.map((item) => {
                  const active = isActive(pathname, item.href)
                  const Icon = item.icon
                  const navItem = messages.nav.items[item.id]
                  return (
                    <Link
                      key={item.href}
                      href={item.href as Route}
                      className={cx(
                        "flex h-8 items-center gap-3 rounded-sm px-3 transition-all duration-[120ms] ease-out",
                        active
                          ? "border-l-2 border-[var(--color-text-primary)] bg-[var(--color-surface-raised)] text-[var(--color-text-primary)]"
                          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]",
                      )}
                    >
                      <Icon
                        className={cx(
                          "h-4 w-4",
                          active
                            ? "text-[var(--color-text-primary)]"
                            : "text-[var(--color-text-muted)]",
                        )}
                        strokeWidth={1.5}
                      />
                      <span className="text-[13px] font-medium">
                        {navItem.label}
                      </span>
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="flex items-center gap-3 border-t border-[var(--color-hairline)] p-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] font-mono text-[11px]">
            {initialsFromPrincipal(principal)}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[12px] font-medium">
              {principal.id ?? messages.common.shell.fallbackPrincipal}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
              {principal.role}
            </div>
          </div>
        </div>
      </aside>

      <div className="ml-[240px] flex min-h-screen flex-1 flex-col">
        <InfoStrip
          items={[
            messages.common.infoStrip.ingestionActive,
            messages.common.infoStrip.uptime,
          ]}
          trailing={messages.common.infoStrip.region}
        />
        <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-[var(--color-hairline-strong)] bg-[var(--color-surface)] px-6">
          <div className="flex min-w-0 items-center gap-4">
            {activeItem ? (
              <BreadcrumbTrail
                section={messages.nav.sections[activeItem.section]}
                current={messages.nav.items[activeItem.id].label}
              />
            ) : null}
            <div className="hidden xl:block">
              <SearchPillButton
                onClick={() => setPaletteOpen(true)}
                label={messages.common.searchPlaceholder}
                shortcut={messages.common.commandShortcut}
              />
            </div>
          </div>
          <div className="ml-auto flex items-center gap-4">
            <button
              type="button"
              className="text-[var(--color-text-muted)] transition-all duration-[120ms] ease-out hover:text-[var(--color-text-primary)]"
              onClick={() => setPaletteOpen(true)}
            >
              <Command className="h-4 w-4" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              className="text-[var(--color-text-muted)] transition-all duration-[120ms] ease-out hover:text-[var(--color-text-primary)]"
            >
              <HelpCircle className="h-4 w-4" strokeWidth={1.5} />
            </button>
            <div className="h-4 w-px bg-[var(--color-hairline)]" />
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-[var(--color-text-muted)]" />
              <span className="font-mono text-[11px] text-[var(--color-text-muted)]">
                {messages.common.shell.version}
              </span>
            </div>
            <div className="flex items-center gap-1 rounded-sm border border-[var(--color-hairline)] p-1">
              {supportedAdminLocales.map((supportedLocale) => (
                <button
                  key={supportedLocale}
                  type="button"
                  disabled={isSwitchingLocale}
                  onClick={() => handleLocaleChange(supportedLocale)}
                  aria-label={`${messages.common.localeLabel}: ${messages.common.locales[supportedLocale]}`}
                  className={cx(
                    "rounded-[2px] px-2 py-1 text-[11px] transition-all duration-[120ms] ease-out",
                    supportedLocale === locale
                      ? "bg-[var(--color-surface-raised)] text-[var(--color-text-primary)]"
                      : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)]",
                  )}
                >
                  {messages.common.locales[supportedLocale]}
                </button>
              ))}
            </div>
          </div>
        </header>
        <main className="flex-1 bg-[var(--color-bg)]">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6">
            {children}
          </div>
        </main>
      </div>

      {isPaletteOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 px-6 pt-24">
          <div className="w-full max-w-2xl rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
            <div className="hairline-strong-b flex items-center gap-3 px-4 py-3">
              <Search className="h-4 w-4 text-[var(--color-text-muted)]" />
              <span className="font-mono text-[12px] text-[var(--color-text-muted)]">
                {messages.common.searchPalettePrompt}
              </span>
              <button
                type="button"
                onClick={() => setPaletteOpen(false)}
                className="ml-auto rounded-sm border border-[var(--color-hairline)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-muted)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)]"
              >
                {messages.common.escape}
              </button>
            </div>
            <div className="grid gap-6 p-4 md:grid-cols-[minmax(0,1fr)_280px]">
              <div>
                <div className="label-text mb-2">
                  {messages.common.navigate}
                </div>
                <div className="space-y-2">
                  {adminNavItems.map((item) => {
                    const Icon = item.icon
                    const active = item.href === activeItem?.href
                    const navItem = messages.nav.items[item.id]
                    return (
                      <Link
                        key={item.href}
                        href={item.href as Route}
                        onClick={() => setPaletteOpen(false)}
                        className={cx(
                          "flex items-start gap-3 rounded-sm border px-3 py-3 transition-all duration-[120ms] ease-out",
                          active
                            ? "border-[var(--color-hairline-strong)] bg-[var(--color-surface-raised)]"
                            : "border-[var(--color-hairline)] hover:bg-[var(--color-surface-raised)]",
                        )}
                      >
                        <Icon
                          className="mt-0.5 h-4 w-4 text-[var(--color-text-muted)]"
                          strokeWidth={1.5}
                        />
                        <div>
                          <div className="text-[13px] font-medium">
                            {navItem.label}
                          </div>
                          <div className="mt-1 text-[12px] text-[var(--color-text-muted)]">
                            {navItem.description}
                          </div>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <div className="label-text mb-2">
                    {messages.common.quickActions}
                  </div>
                  <div className="space-y-2">
                    {quickLinks.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href as Route}
                        onClick={() => setPaletteOpen(false)}
                        className="flex items-center justify-between rounded-sm border border-[var(--color-hairline)] px-3 py-2 text-[13px] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)]"
                      >
                        <span>{messages.nav.items[item.id].label}</span>
                        <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
                          {messages.nav.sections[item.section]}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
                <div className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <Sparkles
                      className="h-4 w-4 text-[var(--color-text-muted)]"
                      strokeWidth={1.5}
                    />
                    <span className="label-text">
                      {messages.common.context}
                    </span>
                  </div>
                  <p className="text-[12px] leading-5 text-[var(--color-text-secondary)]">
                    {messages.common.paletteContext}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
