"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { History, LogOut, UserRound } from "lucide-react"
import { useTranslations } from "next-intl"

import { useFloatingSearchPinned } from "@/components/FloatingSearchProvider"
import {
  clearDatadogRumUser,
  identifyDatadogRumUser,
} from "@/components/DatadogRum"

type AccountUser = {
  id?: string
  email?: string
  name?: string
  image?: string
}

type AccountState =
  | { status: "loading" }
  | { status: "hidden" }
  | { status: "signed-out" }
  | { status: "signed-in"; user?: AccountUser }

type AccountSession = {
  accountGateEnabled: boolean
  authenticated: boolean
  user?: AccountUser
}

const ACCOUNT_USER_FIELDS = [
  "id",
  "email",
  "name",
  "image",
] as const satisfies readonly (keyof AccountUser)[]

function currentReturnTo(): string {
  if (typeof window === "undefined") return "/watch"
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

function accountAuthUrl(path: "/api/auth/login" | "/api/auth/logout"): string {
  const url = new URL(`/watch${path}`, window.location.origin)
  url.searchParams.set("returnTo", currentReturnTo())
  return url.toString()
}

export function AccountControl() {
  const t = useTranslations("AccountControl")
  const [state, setState] = useState<AccountState>({ status: "loading" })
  const [menuOpen, setMenuOpen] = useState(false)
  const { searchChromeVisible } = useFloatingSearchPinned()
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    const callbackURL = currentReturnTo()
    const url = new URL("/watch/api/auth/session", window.location.origin)
    url.searchParams.set("callbackURL", callbackURL)

    void fetch(url.toString(), {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Account session request failed")

        const session: unknown = await response.json()
        if (!isAccountSession(session)) {
          throw new Error("Invalid account session response")
        }
        return session
      })
      .then((session) => {
        if (cancelled) return
        if (session.authenticated) {
          identifyDatadogRumUser(session.user)
        } else {
          clearDatadogRumUser()
        }
        setState(
          session.authenticated
            ? { status: "signed-in", user: session.user }
            : session.accountGateEnabled
              ? { status: "signed-out" }
              : { status: "hidden" },
        )
      })
      .catch(() => {
        if (!cancelled) {
          clearDatadogRumUser()
          setState({ status: "hidden" })
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!menuOpen) return

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false)
    }

    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [menuOpen])

  useEffect(() => {
    // The menu should be discarded when the shared watch chrome auto-hides.
    if (searchChromeVisible) return

    const timeout = window.setTimeout(() => {
      setMenuOpen(false)
    }, 0)
    return () => {
      window.clearTimeout(timeout)
    }
  }, [searchChromeVisible])

  const action = useMemo(() => {
    if (state.status === "signed-in") {
      return {
        label: t("signOut"),
        href: "/api/auth/logout" as const,
      }
    }
    return {
      label: t("signIn"),
      href: "/api/auth/login" as const,
    }
  }, [state.status, t])

  const user = state.status === "signed-in" ? state.user : undefined
  const displayName = user?.name?.trim() || user?.email?.trim() || t("signedIn")
  const email = user?.email?.trim()
  const buttonLabel =
    state.status === "signed-in" ? t("accountMenu") : action.label

  if (state.status === "loading" || state.status === "hidden") return null

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        aria-label={buttonLabel}
        aria-haspopup={state.status === "signed-in" ? "menu" : undefined}
        aria-expanded={state.status === "signed-in" ? menuOpen : undefined}
        title={buttonLabel}
        data-testid="watch-account-control"
        data-auth-state={state.status}
        onClick={() => {
          if (state.status === "signed-in") {
            setMenuOpen((open) => !open)
            return
          }
          window.location.assign(accountAuthUrl(action.href))
        }}
        className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-stone-100 transition-[color,transform] duration-300 ease-out hover:text-white focus-visible:ring-2 focus-visible:ring-stone-300 focus-visible:outline-none md:h-[52px] md:w-12"
      >
        {state.status === "signed-in" ? (
          <Avatar user={user} sizeClassName="h-8 w-8 md:h-9 md:w-9" />
        ) : (
          <UserRound
            aria-hidden="true"
            className="h-6 w-6 drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.35)]"
          />
        )}
      </button>

      {state.status === "signed-in" && menuOpen ? (
        <div
          role="menu"
          aria-label={t("accountMenu")}
          data-testid="watch-account-menu"
          className="absolute top-full right-0 z-50 mt-3 w-72 overflow-hidden rounded-lg border border-white/15 bg-stone-950/95 text-stone-50 shadow-2xl shadow-black/35 backdrop-blur-md"
        >
          <div className="flex items-center gap-3 px-4 py-4">
            <Avatar user={user} sizeClassName="h-11 w-11" />
            <div className="min-w-0">
              <p className="truncate text-base sm:text-sm font-semibold">
                {displayName}
              </p>
              {email ? (
                <p className="mt-0.5 truncate text-sm sm:text-xs text-stone-300">
                  {email}
                </p>
              ) : null}
            </div>
          </div>
          <div className="border-t border-white/10 p-2">
            <button
              type="button"
              role="menuitem"
              className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left text-base sm:text-sm text-stone-100 transition-colors hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none"
              onClick={() => {
                window.location.assign("/watch/history")
              }}
            >
              <History aria-hidden="true" className="h-4 w-4" />
              <span>{t("history")}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left text-base sm:text-sm text-stone-100 transition-colors hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none"
              onClick={() => {
                window.location.assign(accountAuthUrl("/api/auth/logout"))
              }}
            >
              <LogOut aria-hidden="true" className="h-4 w-4" />
              <span>{t("logOut")}</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function isAccountSession(value: unknown): value is AccountSession {
  if (!isRecord(value)) return false
  if (typeof value.accountGateEnabled !== "boolean") return false
  if (typeof value.authenticated !== "boolean") return false
  if (!value.authenticated && value.user !== undefined) return false
  if (value.user !== undefined && !isAccountUser(value.user)) return false

  return true
}

function isAccountUser(value: unknown): value is AccountUser {
  if (!isRecord(value)) return false

  return ACCOUNT_USER_FIELDS.every(
    (field) => value[field] === undefined || typeof value[field] === "string",
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
}

function Avatar({
  user,
  sizeClassName,
}: {
  user?: AccountUser
  sizeClassName: string
}) {
  const t = useTranslations("AccountControl")
  const label = user?.name || user?.email || t("account")
  const initials = getInitials(label)

  if (user?.image) {
    return (
      <span
        aria-hidden="true"
        className={`${sizeClassName} rounded-full border border-white/25 object-cover shadow-[0_1px_3px_rgba(0,0,0,0.35)]`}
        style={{
          backgroundImage: `url("${user.image.replaceAll('"', '\\"')}")`,
          backgroundPosition: "center",
          backgroundSize: "cover",
        }}
      />
    )
  }

  return (
    <span
      aria-hidden="true"
      className={`${sizeClassName} inline-flex items-center justify-center rounded-full border border-white/25 bg-stone-100 text-sm sm:text-xs font-semibold text-stone-900 shadow-[0_1px_3px_rgba(0,0,0,0.35)]`}
    >
      {initials}
    </span>
  )
}

function getInitials(value: string) {
  const parts = value
    .replace(/@.*/, "")
    .split(/\s+|[._-]/)
    .map((part) => part.trim())
    .filter(Boolean)

  return (parts[0]?.[0] ?? "U").toUpperCase()
}
