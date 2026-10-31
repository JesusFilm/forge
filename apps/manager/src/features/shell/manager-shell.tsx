"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import type { LucideIcon } from "lucide-react"
import {
  Bell,
  Building2,
  ChevronRight,
  ExternalLink,
  FileJson2,
  KeyRound,
  LogOut,
  Moon,
  PanelLeft,
  Settings2,
  ShieldCheck,
  Sun,
  UserRound,
} from "lucide-react"
import { apiFetch } from "@/lib/api-fetch"
import {
  MANAGER_THEME_STORAGE_KEY,
  resolveManagerTheme,
  type ManagerTheme,
} from "@/lib/manager-theme"
import { cn } from "@/lib/utils"
import { MANAGER_SIDEBAR_COOKIE } from "@/lib/manager-sidebar"
import { requestClientNavigation } from "@/lib/client-navigation"
import {
  getActiveStudioSubmenuItemKey,
  getStudioCurrentProductKey,
  getStudioProductSubmenu,
  isPathnameInStudioProductSubmenu,
  isSubtitleLabPathname,
} from "./studio-product-submenu"
import {
  getStudioProductGroups,
  StudioProductSwitcher,
  type StudioSelectableProduct,
  type StudioSelectableProductKey,
} from "./studio-product-switcher"

export type ManagerShellUser = {
  username: string
  email: string
}

export type ManagerShellReportType = "subtitles" | "audio" | "meta"

type ManagerShellContextValue = {
  reportType: ManagerShellReportType
  setHeaderContent: (content: ReactNode | null) => void
  setSidebarContent: (content: ReactNode | null) => void
  setReportType: (reportType: ManagerShellReportType) => void
}

type UserMenuRow = {
  description: string
  icon: LucideIcon
  label: string
  tone?: "danger"
  onClick?: () => void
}

const TOPBAR_ICON_BUTTON_CLASS =
  "inline-flex h-[54px] min-h-[54px] w-[54px] shrink-0 items-center justify-center rounded-[var(--ds-radius)] border border-[color:var(--ds-line)] bg-[color:var(--ds-panel)] p-0 text-[color:var(--ds-muted)] shadow-none transition-[background-color,border-color,box-shadow,transform,color] duration-150 hover:border-[color:var(--ds-line-strong)] hover:bg-[color:var(--ds-hover)] hover:text-[color:var(--ds-ink)] hover:shadow-[0_8px_18px_rgba(17,17,17,0.08)] focus-visible:outline-none focus-visible:ring-[0.5px] focus-visible:ring-[color:var(--ds-black)] active:translate-y-px active:border-[color:var(--ds-line-strong)] active:bg-[color:color-mix(in_srgb,var(--ds-black)_8%,var(--ds-panel))]"

const REPORT_STORAGE_KEY = "forge-coverage-report"

const ManagerShellContext = createContext<ManagerShellContextValue | null>(null)

const MANAGER_THEME_CHANGE_EVENT = "manager-theme-change"

function subscribeToManagerTheme(onStoreChange: () => void): () => void {
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")

  const readStoredTheme = (): ManagerTheme | null => {
    try {
      const storedTheme = window.localStorage.getItem(MANAGER_THEME_STORAGE_KEY)
      return storedTheme === "dark" || storedTheme === "light"
        ? storedTheme
        : null
    } catch {
      return null
    }
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== MANAGER_THEME_STORAGE_KEY) {
      return
    }

    const hasExplicitTheme =
      event.newValue === "dark" || event.newValue === "light"
    document.documentElement.dataset.theme = resolveManagerTheme(
      event.newValue,
      systemTheme.matches,
    )
    document.documentElement.dataset.themeSource = hasExplicitTheme
      ? "user"
      : "system"
    onStoreChange()
  }

  const handleSystemThemeChange = (event: MediaQueryListEvent) => {
    if (document.documentElement.dataset.themeSource === "user") {
      return
    }

    document.documentElement.dataset.theme = resolveManagerTheme(
      null,
      event.matches,
    )
    onStoreChange()
  }

  if (document.documentElement.dataset.themeSource !== "user") {
    const storedTheme = readStoredTheme()
    document.documentElement.dataset.theme = resolveManagerTheme(
      storedTheme,
      systemTheme.matches,
    )
    document.documentElement.dataset.themeSource = storedTheme
      ? "user"
      : "system"
  }

  window.addEventListener("storage", handleStorage)
  window.addEventListener(MANAGER_THEME_CHANGE_EVENT, onStoreChange)
  systemTheme.addEventListener("change", handleSystemThemeChange)

  return () => {
    window.removeEventListener("storage", handleStorage)
    window.removeEventListener(MANAGER_THEME_CHANGE_EVENT, onStoreChange)
    systemTheme.removeEventListener("change", handleSystemThemeChange)
  }
}

function getManagerThemeSnapshot(): ManagerTheme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light"
}

export function StudioThemeSync() {
  useSyncExternalStore(
    subscribeToManagerTheme,
    getManagerThemeSnapshot,
    () => "light",
  )

  return null
}

export function StudioThemeSwitch() {
  const theme = useSyncExternalStore(
    subscribeToManagerTheme,
    getManagerThemeSnapshot,
    () => "light",
  )

  const isDark = theme === "dark"
  const nextTheme: ManagerTheme = isDark ? "light" : "dark"

  return (
    <button
      type="button"
      role="menuitemcheckbox"
      className="group flex min-h-[58px] w-full cursor-pointer select-none items-center gap-3 rounded-xl border-0 bg-transparent px-2.5 py-1.5 text-left transition-colors duration-75 hover:bg-[color:color-mix(in_srgb,var(--ds-black)_5%,transparent)] focus-visible:outline-none focus-visible:ring-[0.5px] focus-visible:ring-[color:var(--ds-black)] active:bg-[color:color-mix(in_srgb,var(--ds-black)_9%,transparent)]"
      aria-label={`Switch to ${nextTheme} mode`}
      aria-checked={isDark}
      onClick={() => {
        document.documentElement.dataset.theme = nextTheme
        document.documentElement.dataset.themeSource = "user"
        try {
          window.localStorage.setItem(MANAGER_THEME_STORAGE_KEY, nextTheme)
        } catch {
          // The in-memory choice still applies when storage is unavailable.
        }
        window.dispatchEvent(new Event(MANAGER_THEME_CHANGE_EVENT))
      }}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color:color-mix(in_srgb,var(--ds-black)_5%,transparent)] text-[color:var(--ds-ink)] transition-colors duration-75 group-hover:bg-[color:color-mix(in_srgb,var(--ds-black)_8%,transparent)]">
        {isDark ? (
          <Moon size={17} strokeWidth={2} aria-hidden="true" />
        ) : (
          <Sun size={17} strokeWidth={2} aria-hidden="true" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-px">
        <span className="truncate text-sm font-semibold leading-[1.05] text-[color:var(--ds-ink)]">
          Dark mode
        </span>
        <span className="truncate text-xs font-medium leading-[1.05] text-[color:var(--ds-muted)]">
          Use a darker appearance
        </span>
      </span>
      <span
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full border border-[color:var(--ds-line-strong)] bg-[color:var(--ds-panel-muted)] transition-colors duration-150",
          isDark && "border-[color:var(--ds-black)] bg-[color:var(--ds-black)]",
        )}
        aria-hidden="true"
      >
        <span
          className={cn(
            "absolute left-0.5 top-0.5 h-[18px] w-[18px] rounded-full bg-[color:var(--ds-panel)] shadow-[0_1px_4px_rgba(17,17,17,0.24)] transition-transform duration-150",
            isDark && "translate-x-5",
          )}
        />
      </span>
    </button>
  )
}

function getStudioProductLabel(key: StudioSelectableProductKey): string {
  for (const group of getStudioProductGroups()) {
    for (const product of group.products) {
      if (product.key === key) {
        return product.label
      }
    }
  }

  return key
}

function readStoredReportType(): ManagerShellReportType {
  if (typeof window === "undefined") {
    return "subtitles"
  }

  try {
    const stored = window.sessionStorage.getItem(REPORT_STORAGE_KEY)
    if (stored === "subtitles" || stored === "audio" || stored === "meta") {
      return stored
    }
  } catch {
    // ignore storage errors
  }

  return "subtitles"
}

function subscribeToHydration() {
  return () => undefined
}

function getClientHydrationSnapshot() {
  return true
}

function getServerHydrationSnapshot() {
  return false
}

function getBreadcrumbs(pathname: string): string[] {
  if (pathname === "/design") {
    return ["Studio", "Design system"]
  }

  if (pathname.startsWith("/dashboard/jobs/")) {
    return ["Studio", "Jobs", "Job detail"]
  }

  if (pathname.startsWith("/dashboard/jobs")) {
    return ["Studio", "Jobs"]
  }

  if (pathname.startsWith("/dashboard/agents")) {
    return ["Studio", "Agents"]
  }

  if (pathname.startsWith("/dashboard/seo")) {
    return ["Studio", "SEO"]
  }

  if (pathname.startsWith("/dashboard/subtitle-lab/assignments/")) {
    return ["Studio", "Subtitle Lab", "Assignment evidence"]
  }

  if (pathname.startsWith("/dashboard/subtitle-lab/comparisons/")) {
    return ["Studio", "Subtitle Lab", "Comparison"]
  }

  if (pathname.startsWith("/dashboard/subtitle-lab/runs/")) {
    return ["Studio", "Subtitle Lab", "Run report"]
  }

  if (pathname.startsWith("/dashboard/subtitle-lab")) {
    return ["Studio", "Subtitle Lab"]
  }

  if (pathname.startsWith("/dashboard/alerts")) {
    return ["Studio", "Alerts"]
  }

  if (pathname.startsWith("/dashboard/smart-crop")) {
    return ["Studio", "Smart Crop"]
  }

  if (pathname.startsWith("/dashboard/shorts/new")) {
    return ["Studio", "Shorts", "New project"]
  }

  if (pathname === "/dashboard/shorts/calendar") {
    return ["Studio", "Shorts", "Planning calendar"]
  }

  if (pathname.startsWith("/dashboard/shorts/")) {
    return ["Studio", "Shorts", "Project"]
  }

  if (pathname.startsWith("/dashboard/shorts")) {
    return ["Studio", "Shorts"]
  }

  return ["Studio", "Coverage"]
}

function StudioUserMenu({ user }: { user: ManagerShellUser }) {
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false)
      }
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    document.addEventListener("mousedown", handleClickOutside)

    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [])

  const handleLogout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" })
    setMenuOpen(false)
    router.push("/login")
    router.refresh()
  }, [router])

  return (
    <div className="relative h-[54px] min-h-[54px]" ref={menuRef}>
      <button
        type="button"
        className={cn(
          TOPBAR_ICON_BUTTON_CLASS,
          menuOpen &&
            "border-[color:var(--ds-black)] text-[color:var(--ds-black)] ring-[0.5px] ring-[color:var(--ds-black)]",
        )}
        aria-label="Open user menu"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        onClick={() => setMenuOpen((open) => !open)}
      >
        <UserRound size={17} aria-hidden="true" />
      </button>

      {menuOpen ? (
        <StudioUserMenuPanel user={user} onLogout={handleLogout} />
      ) : null}
    </div>
  )
}

export function StudioUserMenuPanel({
  onLogout,
  user,
}: {
  onLogout: () => void
  user: ManagerShellUser
}) {
  const userMenuRows: UserMenuRow[] = [
    {
      label: "Workspace settings",
      description: "Manage workspace preferences",
      icon: Settings2,
    },
    {
      label: "Manager API keys",
      description: "View and manage API keys",
      icon: KeyRound,
    },
    {
      label: "Access and permissions",
      description: "Manage access for your workspace",
      icon: ShieldCheck,
    },
    {
      label: "Docs and resources",
      description: "Guides, references and help",
      icon: FileJson2,
    },
    {
      label: "Terms and privacy",
      description: "View terms of service and privacy policy",
      icon: ExternalLink,
    },
    {
      label: "Sign out",
      description: "Sign out of your account",
      icon: LogOut,
      tone: "danger",
      onClick: onLogout,
    },
  ]

  const renderMenuRow = ({
    description,
    icon: Icon,
    label,
    onClick,
    tone,
  }: UserMenuRow) => {
    const isDanger = tone === "danger"

    return (
      <button
        key={label}
        type="button"
        role="menuitem"
        onClick={onClick}
        className={cn(
          "group flex min-h-[50px] w-full cursor-pointer select-none items-center gap-3 rounded-xl border-0 bg-transparent px-2.5 py-1.5 text-left transition-colors duration-75 hover:bg-[color:color-mix(in_srgb,var(--ds-black)_5%,transparent)] focus-visible:outline-none focus-visible:ring-[0.5px] focus-visible:ring-[color:var(--ds-black)] active:bg-[color:color-mix(in_srgb,var(--ds-black)_9%,transparent)]",
          isDanger &&
            "hover:bg-[color:color-mix(in_srgb,var(--ds-danger)_8%,transparent)] active:bg-[color:color-mix(in_srgb,var(--ds-danger)_12%,transparent)]",
        )}
      >
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color:color-mix(in_srgb,var(--ds-black)_5%,transparent)] text-[color:var(--ds-ink)] transition-colors duration-75 group-hover:bg-[color:color-mix(in_srgb,var(--ds-black)_8%,transparent)]",
            isDanger &&
              "bg-[color:color-mix(in_srgb,var(--ds-danger)_9%,transparent)] text-[color:var(--ds-danger)] group-hover:bg-[color:color-mix(in_srgb,var(--ds-danger)_13%,transparent)]",
          )}
        >
          <Icon size={17} strokeWidth={2} aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col justify-center gap-px">
          <span
            className={cn(
              "truncate text-sm font-semibold leading-[1.05] text-[color:var(--ds-ink)]",
              isDanger && "text-[color:var(--ds-danger)]",
            )}
          >
            {label}
          </span>
          <span className="truncate text-xs font-medium leading-[1.05] text-[color:var(--ds-muted)]">
            {description}
          </span>
        </span>
        {!isDanger ? (
          <ChevronRight
            className="h-4 w-4 shrink-0 text-[color:var(--ds-muted)] transition-transform duration-75 group-hover:translate-x-0.5 group-hover:text-[color:var(--ds-ink)]"
            aria-hidden="true"
          />
        ) : null}
      </button>
    )
  }

  return (
    <div
      className="absolute right-0 top-[calc(100%+12px)] z-[70] w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-[calc(var(--ds-radius)+12px)] border border-[color:var(--ds-line)] bg-[color:var(--ds-panel)] p-3.5 shadow-[0_20px_55px_rgba(17,17,17,0.14)] animate-in fade-in-0 zoom-in-95 duration-150"
      role="menu"
      aria-label="User menu"
    >
      <section className="rounded-[calc(var(--ds-radius)+8px)] border border-[color:var(--ds-line)] bg-[color:var(--ds-panel)] p-3.5 shadow-[0_8px_20px_rgba(17,17,17,0.035)]">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[color:color-mix(in_srgb,var(--ds-black)_7%,transparent)] text-[color:var(--ds-black)]">
            <UserRound size={24} strokeWidth={2} aria-hidden="true" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-px">
            <strong className="truncate text-base font-semibold leading-[1.05] text-[color:var(--ds-ink)]">
              {user.username}
            </strong>
            <span className="truncate text-sm font-medium leading-[1.05] text-[color:var(--ds-muted)]">
              {user.email}
            </span>
          </div>
          <button
            type="button"
            role="menuitem"
            className="inline-flex h-10 shrink-0 cursor-pointer select-none items-center gap-2 rounded-xl border border-[color:var(--ds-black)] bg-[color:var(--ds-black)] px-4 text-sm font-semibold text-[color:var(--ds-panel)] shadow-[0_8px_18px_rgba(17,17,17,0.16)] transition-colors duration-75 hover:bg-[color:color-mix(in_srgb,var(--ds-black)_88%,var(--ds-panel))] focus-visible:outline-none focus-visible:ring-[0.5px] focus-visible:ring-[color:var(--ds-black)] active:translate-y-px"
          >
            <Building2 size={17} strokeWidth={2} aria-hidden="true" />
            Workspace
          </button>
        </div>
      </section>

      <div className="px-2.5 pb-1 pt-4 text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--ds-muted)]">
        Workspace
      </div>
      <div className="grid gap-0.5">
        {userMenuRows.slice(0, 3).map(renderMenuRow)}
      </div>

      <div className="my-2.5 h-px bg-[color:var(--ds-line)]" />

      <div className="px-2.5 pb-1 text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--ds-muted)]">
        Appearance
      </div>
      <div className="grid gap-0.5">
        <StudioThemeSwitch />
      </div>

      <div className="my-2.5 h-px bg-[color:var(--ds-line)]" />

      <div className="px-2.5 pb-1 text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--ds-muted)]">
        Resources
      </div>
      <div className="grid gap-0.5">
        {userMenuRows.slice(3, 5).map(renderMenuRow)}
      </div>

      <div className="my-2.5 h-px bg-[color:var(--ds-line)]" />

      <div className="grid gap-0.5">
        {userMenuRows.slice(5).map(renderMenuRow)}
      </div>
    </div>
  )
}

function useHydrationSafeManagerShellState(): ManagerShellContextValue | null {
  const context = useContext(ManagerShellContext)
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    getClientHydrationSnapshot,
    getServerHydrationSnapshot,
  )

  // The shell can finish hydrating while a report behind Suspense is still
  // dehydrated. Each consumer must match its own server snapshot first.
  return useMemo(() => {
    if (!context || hydrated || context.reportType === "subtitles")
      return context
    return { ...context, reportType: "subtitles" }
  }, [context, hydrated])
}

export function useManagerShellState(): ManagerShellContextValue {
  const context = useHydrationSafeManagerShellState()

  if (!context) {
    throw new Error(
      "useManagerShellState must be used within ManagerDashboardShell",
    )
  }

  return context
}

export function useOptionalManagerShellState(): ManagerShellContextValue | null {
  return useHydrationSafeManagerShellState()
}

export function ManagerShellHeaderSlot({ children }: { children: ReactNode }) {
  const shell = useOptionalManagerShellState()

  useEffect(() => {
    if (!shell) {
      return
    }

    shell.setHeaderContent(children)

    return () => {
      shell.setHeaderContent(null)
    }
  }, [children, shell])

  return null
}

export function ManagerShellSidebarSlot({ children }: { children: ReactNode }) {
  const shell = useOptionalManagerShellState()

  useEffect(() => {
    if (!shell) {
      return
    }

    shell.setSidebarContent(children)

    return () => {
      shell.setSidebarContent(null)
    }
  }, [children, shell])

  return null
}

export function ManagerDashboardShell({
  children,
  user,
  initialSidebarCollapsed = false,
}: {
  children: ReactNode
  initialSidebarCollapsed?: boolean
  user: ManagerShellUser
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const toggleId = useId()
  const [headerContent, setHeaderContent] = useState<ReactNode | null>(null)
  const [sidebarContent, setSidebarContent] = useState<ReactNode | null>(null)
  const [clientReportType, setReportTypeState] =
    useState<ManagerShellReportType>(() => readStoredReportType())
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    getClientHydrationSnapshot,
    getServerHydrationSnapshot,
  )
  // The first hydration render must match the server's submenu structure.
  // Retain the saved client value without writing over it during restoration.
  const reportType = hydrated ? clientReportType : "subtitles"
  const [queueCount, setQueueCount] = useState<number | null>(null)
  // A product chosen in the switcher whose route has not loaded yet, so its
  // submenu shows immediately; it lapses once the pathname changes.
  const [pendingProduct, setPendingProduct] = useState<{
    key: StudioSelectableProductKey
    pathname: string
  } | null>(null)
  const breadcrumbs = useMemo(() => getBreadcrumbs(pathname), [pathname])

  const pendingKey =
    pendingProduct?.pathname === pathname ? pendingProduct.key : null
  if (pendingProduct && !pendingKey) {
    setPendingProduct(null)
  }

  // Subtitle Lab belongs only to Subtitles, so visiting it selects that report
  // (unless Audio or Meta was just chosen and the report is loading).
  const isSubtitleLab = isSubtitleLabPathname(pathname)
  if (isSubtitleLab && !pendingKey && reportType !== "subtitles") {
    setReportTypeState("subtitles")
  }

  // Route products are current on their pages; Report and Jobs follow the
  // report context. The selected product owns the submenu below the switcher.
  const currentProductKey =
    pendingKey ?? getStudioCurrentProductKey(pathname, reportType)
  const submenuItems = getStudioProductSubmenu(currentProductKey)
  // While the chosen product's route loads, none of its items is active yet.
  const activeSubmenuKey = pendingKey
    ? null
    : getActiveStudioSubmenuItemKey(
        submenuItems,
        pathname,
        searchParams?.toString(),
      )

  const setReportType = useCallback(
    (nextReportType: ManagerShellReportType) => {
      setReportTypeState(nextReportType)

      if (typeof window === "undefined") {
        return
      }

      try {
        window.sessionStorage.setItem(REPORT_STORAGE_KEY, nextReportType)
      } catch {
        // ignore storage errors
      }
    },
    [],
  )

  const handleProductSelect = useCallback(
    (product: StudioSelectableProduct) => {
      const inPlace =
        product.kind === "report" &&
        isPathnameInStudioProductSubmenu(
          product.key,
          pathname,
          searchParams?.toString(),
        )
      const href =
        product.kind === "report" ? "/dashboard/coverage" : product.href
      // Ask the active editor before changing report storage or the pending
      // submenu. In-place Report/Jobs context changes do not leave the page.
      if (!inPlace && !requestClientNavigation(href)) return false

      if (product.kind === "report") {
        setReportType(product.key)

        // Report and Jobs are shared by every report product; other pages
        // (Subtitle Lab, route products) fall back to the report.
        if (inPlace) {
          setPendingProduct(null)
          return
        }

        setPendingProduct({ key: product.key, pathname })
        router.push("/dashboard/coverage")
        return
      }

      setPendingProduct(
        pathname === product.href ? null : { key: product.key, pathname },
      )
      router.push(product.href)
    },
    [pathname, router, searchParams, setReportType],
  )

  useEffect(() => {
    if (!isSubtitleLab) {
      return
    }

    try {
      window.sessionStorage.setItem(REPORT_STORAGE_KEY, "subtitles")
    } catch {
      // ignore storage errors
    }
  }, [isSubtitleLab])

  useEffect(() => {
    let cancelled = false

    async function loadCount() {
      try {
        const response = await apiFetch("/api/jobs?view=count", {
          cache: "no-store",
        })

        if (!response.ok) {
          return
        }

        const payload = (await response.json()) as { total?: number }
        if (!cancelled) {
          setQueueCount(payload.total ?? 0)
        }
      } catch {
        // ignore polling errors
      }
    }

    void loadCount()
    const intervalId = window.setInterval(() => {
      void loadCount()
    }, 30000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [])

  const contextValue = useMemo<ManagerShellContextValue>(
    () => ({
      reportType,
      setHeaderContent,
      setSidebarContent,
      setReportType,
    }),
    [reportType, setReportType],
  )

  return (
    <ManagerShellContext.Provider value={contextValue}>
      <StudioThemeSync />
      <main className="design-system-eleven studio-dashboard-shell">
        <section
          className="design-system-shell"
          aria-label="Studio dashboard shell"
        >
          <aside className="design-system-shell-sidebar" aria-label="Primary">
            <input
              aria-label="Collapse sidebar"
              className="design-system-sidebar-checkbox sr-only"
              id={toggleId}
              defaultChecked={initialSidebarCollapsed}
              onChange={(event) => {
                document.cookie = `${MANAGER_SIDEBAR_COOKIE}=${event.currentTarget.checked ? "collapsed" : "expanded"}; Path=/; Max-Age=31536000; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`
              }}
              type="checkbox"
            />

            <div className="design-system-shell-logo">
              <Image
                alt=""
                aria-hidden="true"
                height={18}
                src="/jesusfilm-sign.svg"
                width={25}
              />
              <span className="design-system-shell-wordmark">Studio</span>
              <span className="design-system-shell-badge">Alpha</span>
            </div>

            <div className="design-system-sidebar-content">
              <StudioProductSwitcher
                currentKey={currentProductKey}
                onSelect={handleProductSelect}
                triggerClassName={TOPBAR_ICON_BUTTON_CLASS}
              />

              <nav
                className="design-system-shell-nav"
                aria-label={`${getStudioProductLabel(currentProductKey)} menu`}
                data-product={currentProductKey}
              >
                {submenuItems.map((item) => {
                  const Icon = item.icon
                  const isActive = item.key === activeSubmenuKey

                  return (
                    <Link
                      key={item.key}
                      href={item.href}
                      aria-label={item.label}
                      title={item.label}
                      className={isActive ? "is-active" : undefined}
                      {...(isActive ? { "aria-current": "page" as const } : {})}
                    >
                      <Icon size={19} aria-hidden="true" />
                      <span>{item.label}</span>
                      {item.badge === "job-queue" &&
                      queueCount != null &&
                      queueCount > 0 ? (
                        <span className="studio-shell-nav-badge">
                          {queueCount}
                        </span>
                      ) : null}
                    </Link>
                  )
                })}
              </nav>
            </div>

            {sidebarContent ? (
              <div className="studio-shell-sidebar-slot">{sidebarContent}</div>
            ) : null}
          </aside>

          <div className="design-system-shell-main">
            <header className="design-system-topbar studio-shell-topbar">
              <div className="studio-shell-topbar-main">
                <div className="design-system-breadcrumb">
                  <label
                    className="design-system-sidebar-toggle"
                    htmlFor={toggleId}
                  >
                    <span className="sr-only">Toggle sidebar</span>
                    <PanelLeft size={18} aria-hidden="true" />
                  </label>

                  {breadcrumbs.map((crumb, index) => (
                    <span className="studio-shell-breadcrumb-item" key={crumb}>
                      {index > 0 ? (
                        <ChevronRight size={15} aria-hidden="true" />
                      ) : null}
                      {index === breadcrumbs.length - 1 ? (
                        <strong>{crumb}</strong>
                      ) : (
                        <span>{crumb}</span>
                      )}
                    </span>
                  ))}
                </div>

                {headerContent ? (
                  <div className="studio-shell-header-slot">
                    {headerContent}
                  </div>
                ) : null}
              </div>

              <div className="design-system-topbar-actions">
                <button
                  type="button"
                  className={TOPBAR_ICON_BUTTON_CLASS}
                  aria-label="Notifications"
                >
                  <Bell size={17} aria-hidden="true" />
                </button>

                <StudioUserMenu user={user} />
              </div>
            </header>

            <div className="studio-shell-content">{children}</div>
          </div>
        </section>
      </main>
    </ManagerShellContext.Provider>
  )
}
