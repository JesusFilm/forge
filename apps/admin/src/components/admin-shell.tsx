"use client"

import type { Role } from "@/auth/principal"
import type { Route } from "next"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  Command,
  Globe,
  HelpCircle,
  LoaderCircle,
  Menu,
  Search,
  Sparkles,
  X,
} from "lucide-react"
import {
  adminNavItems,
  adminNavSections,
  getNavItem,
  isNavItemVisible,
} from "@/components/admin-nav"
import { useAdminI18n } from "@/i18n/client"
import { supportedAdminLocales } from "@/i18n/messages"
import { BreadcrumbTrail, SearchPillButton, cx } from "@/components/admin-ui"

type PrincipalView = {
  id: string | null
  role: Role
}

type ProfileView = {
  name: string | null
  email: string | null
  image: string | null
}

type NavigationFeedbackCheck = {
  button?: number
  currentHref: string
  disabled?: boolean
  download?: boolean
  href: string
  modified?: boolean
  target?: string | null
}

const ADMIN_ROUTE_PENDING_TIMEOUT_MS = 8000
const ADMIN_ROUTE_FEEDBACK_EXIT_MS = 360
const ADMIN_ROUTE_FEEDBACK_MIN_VISIBLE_MS = 520
export const ADMIN_NAVIGATION_PENDING_EVENT = "admin:navigation-pending"

function isDashboardPathname(pathname: string) {
  return pathname === "/dashboard" || pathname.startsWith("/dashboard/")
}

export function shouldStartAdminNavigationFeedback({
  button = 0,
  currentHref,
  disabled = false,
  download = false,
  href,
  modified = false,
  target = null,
}: NavigationFeedbackCheck) {
  if (disabled || download || modified || button !== 0) {
    return false
  }

  if (target && target !== "_self") {
    return false
  }

  try {
    const destination = new URL(href, currentHref)
    const current = new URL(currentHref)

    if (destination.origin !== current.origin) {
      return false
    }

    if (!isDashboardPathname(destination.pathname)) {
      return false
    }

    return (
      destination.pathname !== current.pathname ||
      destination.search !== current.search
    )
  } catch {
    return false
  }
}

function isElementDisabled(element: Element) {
  return (
    element.hasAttribute("disabled") ||
    element.getAttribute("aria-disabled") === "true" ||
    Boolean(element.closest("[aria-disabled='true'],[disabled]"))
  )
}

function routeChangingFormHref(form: HTMLFormElement, currentHref: string) {
  const method = (form.getAttribute("method") ?? "get").toLowerCase()
  if (method !== "get") {
    return null
  }

  const url = new URL(form.getAttribute("action") || currentHref, currentHref)
  const searchParams = new URLSearchParams()
  for (const [key, value] of new FormData(form)) {
    if (typeof value === "string") {
      searchParams.append(key, value)
    }
  }
  url.search = searchParams.toString()
  return url.href
}

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") {
    return pathname === href
  }
  return pathname.startsWith(href)
}

function initialsFromProfile(profile: ProfileView | null) {
  const source = profileLabel(profile)
  return source.slice(0, 1).toUpperCase() || "F"
}

function prettifyName(value: string) {
  const words = value
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  if (!words) return ""

  return words
    .split(" ")
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ")
}

function profileLabel(profile: ProfileView | null) {
  const name = profile?.name?.trim()
  if (name) return name

  const emailLocalPart = profile?.email?.split("@")[0]
  if (emailLocalPart) return prettifyName(emailLocalPart)

  return "Forge Admin"
}

export function AdminShell({
  principal,
  profile = null,
  children,
}: {
  principal: PrincipalView
  profile?: ProfileView | null
  children: ReactNode
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { locale, messages } = useAdminI18n()
  const [isPaletteOpen, setPaletteOpen] = useState(false)
  const [isNavOpen, setNavOpen] = useState(false)
  const [isSwitchingLocale, setIsSwitchingLocale] = useState(false)
  const [navigationPending, setNavigationPending] = useState(false)
  const [navigationFeedbackVisible, setNavigationFeedbackVisible] =
    useState(false)
  const [navigationFeedbackExiting, setNavigationFeedbackExiting] =
    useState(false)
  const navigationFeedbackShownAt = useRef(0)
  const routeKey = `${pathname}?${searchParams.toString()}`
  const activeItem = getNavItem(pathname)
  const isFullCanvasRoute =
    (pathname.startsWith("/dashboard/experiences/") &&
      pathname !== "/dashboard/experiences") ||
    pathname.startsWith("/dashboard/media") ||
    pathname.startsWith("/dashboard/workflows/")
  const visibleNavItems = adminNavItems.filter((item) =>
    isNavItemVisible(principal, item),
  )
  const visibleNavSections = adminNavSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => isNavItemVisible(principal, item)),
    }))
    .filter((section) => section.items.length > 0)

  const quickLinks = useMemo(
    () => visibleNavItems.filter((item) => item.href !== pathname).slice(0, 6),
    [pathname, visibleNavItems],
  )

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setPaletteOpen((current) => !current)
      }

      if (event.key === "Escape") {
        setPaletteOpen(false)
        setNavOpen(false)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  useEffect(() => {
    setNavOpen(false)
  }, [pathname])

  useEffect(() => {
    setNavigationPending(false)
  }, [routeKey])

  useEffect(() => {
    if (!navigationPending) {
      return
    }

    const timeout = window.setTimeout(
      () => setNavigationPending(false),
      ADMIN_ROUTE_PENDING_TIMEOUT_MS,
    )

    return () => window.clearTimeout(timeout)
  }, [navigationPending])

  useEffect(() => {
    if (navigationPending) {
      navigationFeedbackShownAt.current = window.performance.now()
      setNavigationFeedbackVisible(true)
      setNavigationFeedbackExiting(false)
      return
    }

    if (!navigationFeedbackVisible) {
      return
    }

    const elapsed = window.performance.now() - navigationFeedbackShownAt.current
    const exitDelay = Math.max(0, ADMIN_ROUTE_FEEDBACK_MIN_VISIBLE_MS - elapsed)
    let exitTimeout: number | undefined
    const removeTimeout = window.setTimeout(() => {
      setNavigationFeedbackExiting(true)
      exitTimeout = window.setTimeout(() => {
        setNavigationFeedbackVisible(false)
        setNavigationFeedbackExiting(false)
      }, ADMIN_ROUTE_FEEDBACK_EXIT_MS)
    }, exitDelay)

    return () => {
      window.clearTimeout(removeTimeout)
      if (exitTimeout) window.clearTimeout(exitTimeout)
    }
  }, [navigationPending, navigationFeedbackVisible])

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const target = event.target
      if (!(target instanceof Element)) {
        return
      }

      const anchor = target.closest("a[href]")
      if (!(anchor instanceof HTMLAnchorElement)) {
        return
      }

      if (
        shouldStartAdminNavigationFeedback({
          button: event.button,
          currentHref: window.location.href,
          disabled: isElementDisabled(anchor),
          download: anchor.hasAttribute("download"),
          href: anchor.href,
          modified:
            event.altKey || event.ctrlKey || event.metaKey || event.shiftKey,
          target: anchor.target,
        })
      ) {
        setNavigationPending(true)
      }
    }

    function handlePendingEvent() {
      setNavigationPending(true)
    }

    function handleSubmit(event: SubmitEvent) {
      const target = event.target
      if (!(target instanceof HTMLFormElement)) {
        return
      }

      const href = routeChangingFormHref(target, window.location.href)
      if (!href) {
        return
      }

      if (
        shouldStartAdminNavigationFeedback({
          currentHref: window.location.href,
          disabled: isElementDisabled(target),
          href,
          target: target.target,
        })
      ) {
        setNavigationPending(true)
      }
    }

    document.addEventListener("click", handleClick, true)
    document.addEventListener("submit", handleSubmit, true)
    window.addEventListener(ADMIN_NAVIGATION_PENDING_EVENT, handlePendingEvent)

    return () => {
      document.removeEventListener("click", handleClick, true)
      document.removeEventListener("submit", handleSubmit, true)
      window.removeEventListener(
        ADMIN_NAVIGATION_PENDING_EVENT,
        handlePendingEvent,
      )
    }
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
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[240px] flex-col border-r border-[var(--color-hairline)] bg-[var(--color-surface)] xl:flex">
        <ShellSidebarContent
          messages={messages}
          pathname={pathname}
          principal={principal}
          profile={profile}
          visibleNavSections={visibleNavSections}
        />
      </aside>

      <div
        className={cx(
          "fixed inset-0 z-50 xl:hidden",
          isNavOpen ? "pointer-events-auto" : "pointer-events-none",
        )}
        aria-hidden={!isNavOpen}
      >
        <button
          type="button"
          className={cx(
            "absolute inset-0 cursor-pointer bg-black/55 backdrop-blur-[3px] transition-opacity duration-200 ease-out",
            isNavOpen ? "opacity-100" : "opacity-0",
          )}
          aria-label="Close navigation"
          tabIndex={isNavOpen ? 0 : -1}
          onClick={() => setNavOpen(false)}
        />
        <aside
          className={cx(
            "absolute inset-y-0 left-0 flex w-[min(300px,calc(100vw-3rem))] flex-col border-r border-[var(--color-hairline)] bg-[var(--color-surface)] shadow-[16px_0_48px_rgba(0,0,0,0.4)] transition-transform duration-200 ease-out will-change-transform",
            isNavOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <ShellSidebarContent
            messages={messages}
            pathname={pathname}
            principal={principal}
            profile={profile}
            visibleNavSections={visibleNavSections}
            onClose={() => setNavOpen(false)}
          />
        </aside>
      </div>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col xl:ml-[240px]">
        <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-[var(--color-hairline-strong)] bg-[var(--color-surface)] px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-4">
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] text-[var(--color-text-muted)] transition-all duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)] xl:hidden"
              aria-label="Open navigation"
              aria-expanded={isNavOpen}
            >
              <Menu className="h-4 w-4" strokeWidth={1.5} />
            </button>
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
          <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-4">
            <button
              type="button"
              className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-sm text-[var(--color-text-muted)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
              onClick={() => setPaletteOpen(true)}
              aria-label={messages.common.openCommandPalette}
              title={messages.common.openCommandPalette}
            >
              <Command className="h-4 w-4" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              disabled
              className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-[var(--color-text-muted)] opacity-45 transition-all duration-[120ms] ease-out disabled:cursor-not-allowed"
              aria-label={messages.common.helpUnavailable}
              title={messages.common.helpUnavailable}
            >
              <HelpCircle className="h-4 w-4" strokeWidth={1.5} />
            </button>
            <div className="h-4 w-px bg-[var(--color-hairline)]" />
            <div className="hidden items-center gap-2 sm:flex">
              <Globe className="h-4 w-4 text-[var(--color-text-muted)]" />
              <span className="font-mono text-[11px] text-[var(--color-text-muted)]">
                {messages.common.shell.version}
              </span>
            </div>
            <div className="flex items-center gap-1 rounded-sm border border-[var(--color-hairline)] p-1">
              {supportedAdminLocales.map((supportedLocale) => {
                const activeLocale = supportedLocale === locale
                return (
                  <button
                    key={supportedLocale}
                    type="button"
                    disabled={isSwitchingLocale || activeLocale}
                    onClick={() => handleLocaleChange(supportedLocale)}
                    aria-current={activeLocale ? "true" : undefined}
                    aria-label={`${messages.common.localeLabel}: ${messages.common.locales[supportedLocale]}`}
                    className={cx(
                      "rounded-[2px] px-2 py-1 text-[11px] transition-all duration-[120ms] ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]",
                      activeLocale
                        ? "bg-[var(--color-surface-raised)] text-[var(--color-text-primary)]"
                        : "cursor-pointer text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]",
                      isSwitchingLocale && !activeLocale && "opacity-45",
                    )}
                  >
                    {messages.common.locales[supportedLocale]}
                  </button>
                )
              })}
            </div>
          </div>
        </header>
        {navigationFeedbackVisible ? (
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            data-admin-navigation-feedback="pending"
            className={cx(
              "fixed right-4 bottom-4 z-50 w-[min(320px,calc(100vw-2rem))] rounded-sm border border-[var(--color-hairline-strong)] bg-[var(--color-surface)] p-3 shadow-[0_16px_40px_rgba(0,0,0,0.38)]",
              navigationFeedbackExiting
                ? "route-feedback-exit"
                : "route-feedback-enter",
            )}
          >
            <div className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase text-[var(--color-success)]">
              <LoaderCircle
                className="h-3.5 w-3.5 animate-spin"
                strokeWidth={1.6}
                aria-hidden="true"
              />
              {messages.common.navigationLoading}
            </div>
            <div
              aria-hidden="true"
              className="mt-3 grid h-1 grid-cols-5 gap-1 overflow-hidden"
            >
              <span className="rounded-full bg-[var(--color-success)]" />
              <span className="animate-pulse rounded-full bg-[var(--color-success)]" />
              <span className="animate-pulse rounded-full bg-[var(--color-success)] opacity-70" />
              <span className="rounded-full bg-[var(--color-hairline-strong)]" />
              <span className="rounded-full bg-[var(--color-hairline-strong)]" />
            </div>
          </div>
        ) : null}
        <main className="min-w-0 flex-1 bg-[var(--color-bg)]">
          <div
            className={cx(
              "flex min-w-0 w-full flex-col",
              isFullCanvasRoute
                ? "max-w-none p-0"
                : "mx-auto max-w-7xl gap-6 p-6",
            )}
          >
            {children}
          </div>
        </main>
      </div>

      {isPaletteOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 px-6 pt-24">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-command-palette-title"
            className="w-full max-w-2xl rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] shadow-[0_8px_24px_rgba(0,0,0,0.4)]"
          >
            <div className="hairline-strong-b flex items-center gap-3 px-4 py-3">
              <Search className="h-4 w-4 text-[var(--color-text-muted)]" />
              <span
                id="admin-command-palette-title"
                className="font-mono text-[12px] text-[var(--color-text-muted)]"
              >
                {messages.common.searchPalettePrompt}
              </span>
              <button
                type="button"
                autoFocus
                onClick={() => setPaletteOpen(false)}
                className="ml-auto cursor-pointer rounded-sm border border-[var(--color-hairline)] px-2 py-1 font-mono text-[10px] text-[var(--color-text-muted)] transition-all duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                aria-label={messages.common.closeCommandPalette}
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
                  {visibleNavItems.map((item) => {
                    const Icon = item.icon
                    const active = item.href === activeItem?.href
                    const navItem = messages.nav.items[item.id]
                    return (
                      <Link
                        key={item.href}
                        href={item.href as Route}
                        onClick={() => setPaletteOpen(false)}
                        className={cx(
                          "flex cursor-pointer items-start gap-3 rounded-sm border px-3 py-3 transition-all duration-[120ms] ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]",
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
                        className="flex cursor-pointer items-center justify-between rounded-sm border border-[var(--color-hairline)] px-3 py-2 text-[13px] transition-all duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
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

type ShellSidebarContentProps = {
  messages: ReturnType<typeof useAdminI18n>["messages"]
  pathname: string
  principal: PrincipalView
  profile: ProfileView | null
  visibleNavSections: Array<{
    label: keyof ReturnType<typeof useAdminI18n>["messages"]["nav"]["sections"]
    items: typeof adminNavItems
  }>
  onClose?: () => void
}

function ShellSidebarContent({
  messages,
  pathname,
  principal,
  profile,
  visibleNavSections,
  onClose,
}: ShellSidebarContentProps) {
  return (
    <>
      <div className="flex items-start justify-between gap-3 px-6 py-4">
        <div className="min-w-0">
          <div className="text-lg font-semibold tracking-[-0.02em]">
            {messages.common.shell.brandName}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
            {messages.common.shell.brandTag}
          </div>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] text-[var(--color-text-muted)] transition-all duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        ) : null}
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {visibleNavSections.map((section) => (
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
                    onClick={onClose}
                    className={cx(
                      "flex h-8 cursor-pointer items-center gap-3 rounded-sm px-3 transition-all duration-[120ms] ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]",
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
        {profile?.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.image}
            alt=""
            className="h-9 w-9 rounded-sm border border-[var(--color-hairline)] object-cover"
          />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] text-[13px] font-semibold text-[var(--color-text-primary)]">
            {initialsFromProfile(profile)}
          </div>
        )}
        <div className="min-w-0" title={profile?.email ?? undefined}>
          <div className="truncate text-[13px] font-medium">
            {profileLabel(profile) ?? messages.common.shell.fallbackPrincipal}
          </div>
          <div className="truncate font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
            {principal.role}
          </div>
        </div>
      </div>
    </>
  )
}
