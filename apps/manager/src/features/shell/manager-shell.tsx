"use client"

import type { Route } from "next"
import Image from "next/image"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import type { LucideIcon } from "lucide-react"
import {
  BarChart2,
  Bell,
  Bot,
  Building2,
  Captions,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Crop,
  ExternalLink,
  FileAudio2,
  FileJson2,
  KeyRound,
  ListChecks,
  LogOut,
  PanelLeft,
  SearchCheck,
  Settings2,
  ShieldCheck,
  UserRound,
} from "lucide-react"
import { apiFetch } from "@/lib/api-fetch"
import { cn } from "@/lib/utils"

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

const reportOptions: Array<{
  icon: LucideIcon
  subtitle: string
  value: ManagerShellReportType
  label: string
}> = [
  {
    value: "subtitles",
    label: "Subtitles",
    subtitle: "Subtitle coverage for the selected language.",
    icon: Captions,
  },
  {
    value: "audio",
    label: "Audio",
    subtitle: "Audio coverage for the selected language.",
    icon: FileAudio2,
  },
  {
    value: "meta",
    label: "Meta",
    subtitle: "Metadata coverage for the selected language.",
    icon: FileJson2,
  },
]

const navItems: Array<{
  href: Route
  icon: LucideIcon
  key: string
  label: string
}> = [
  {
    key: "coverage",
    href: "/dashboard/coverage",
    label: "Report",
    icon: BarChart2,
  },
  {
    key: "jobs",
    href: "/dashboard/jobs",
    label: "Jobs",
    icon: ListChecks,
  },
  {
    key: "smart-crop",
    href: "/dashboard/smart-crop",
    label: "Smart Crop",
    icon: Crop,
  },
  {
    key: "shorts",
    href: "/dashboard/shorts",
    label: "Shorts",
    icon: Clapperboard,
  },
  {
    key: "seo",
    href: "/dashboard/seo",
    label: "SEO",
    icon: SearchCheck,
  },
  {
    key: "agents",
    href: "/dashboard/agents",
    label: "Agents",
    icon: Bot,
  },
]

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

function isActiveRoute(pathname: string, href: string): boolean {
  if (href === "/dashboard/coverage") {
    return (
      pathname === "/dashboard" || pathname.startsWith("/dashboard/coverage")
    )
  }

  if (href === "/dashboard/jobs") {
    return pathname.startsWith("/dashboard/jobs")
  }

  return pathname === href || pathname.startsWith(`${href}/`)
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

  if (pathname.startsWith("/dashboard/smart-crop")) {
    return ["Studio", "Smart Crop"]
  }

  if (pathname.startsWith("/dashboard/shorts/new")) {
    return ["Studio", "Shorts", "New short"]
  }

  if (pathname.startsWith("/dashboard/shorts/")) {
    return ["Studio", "Shorts", "Short detail"]
  }

  if (pathname.startsWith("/dashboard/shorts")) {
    return ["Studio", "Shorts"]
  }

  return ["Studio", "Coverage"]
}

function ReportIcon({
  icon: Icon,
  value,
}: {
  icon: LucideIcon
  value: ManagerShellReportType
}) {
  return (
    <span className={`design-system-report-icon is-${value}`}>
      <Icon size={18} aria-hidden="true" strokeWidth={2} />
    </span>
  )
}

function StudioReportSwitcher() {
  const shell = useManagerShellState()
  const [isOpen, setIsOpen] = useState(false)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const selectedReport =
    reportOptions.find((option) => option.value === shell.reportType) ??
    reportOptions[0]
  const SelectedIcon = selectedReport.icon

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false)
      }
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (
        shellRef.current &&
        !shellRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    document.addEventListener("mousedown", handleClickOutside)

    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [])

  return (
    <div
      className={`design-system-report-switch${isOpen ? " is-open" : ""}`}
      ref={shellRef}
    >
      <button
        type="button"
        className="design-system-workspace-button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`Current report: ${selectedReport.label}`}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span className="design-system-avatar design-system-avatar--report">
          <ReportIcon icon={SelectedIcon} value={selectedReport.value} />
        </span>
        <span className="design-system-workspace-copy">
          <strong>{selectedReport.label}</strong>
          <small>{selectedReport.subtitle}</small>
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>

      {isOpen ? (
        <div
          className="design-system-report-switch-menu"
          role="listbox"
          aria-label="Report selector"
        >
          {reportOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`design-system-report-switch-option${
                option.value === selectedReport.value ? " is-selected" : ""
              }`}
              role="option"
              aria-selected={option.value === selectedReport.value}
              onClick={() => {
                shell.setReportType(option.value)
                setIsOpen(false)
              }}
            >
              <ReportIcon icon={option.icon} value={option.value} />
              <span className="design-system-report-switch-copy">
                <strong>{option.label}</strong>
                <small>{option.subtitle}</small>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
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
            className="inline-flex h-10 shrink-0 cursor-pointer select-none items-center gap-2 rounded-xl border border-[color:var(--ds-black)] bg-[color:var(--ds-black)] px-4 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(17,17,17,0.16)] transition-colors duration-75 hover:bg-[color:color-mix(in_srgb,var(--ds-black)_88%,white)] focus-visible:outline-none focus-visible:ring-[0.5px] focus-visible:ring-[color:var(--ds-black)] active:translate-y-px"
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

export function useManagerShellState(): ManagerShellContextValue {
  const context = useContext(ManagerShellContext)

  if (!context) {
    throw new Error(
      "useManagerShellState must be used within ManagerDashboardShell",
    )
  }

  return context
}

export function useOptionalManagerShellState(): ManagerShellContextValue | null {
  return useContext(ManagerShellContext)
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
}: {
  children: ReactNode
  user: ManagerShellUser
}) {
  const pathname = usePathname()
  const toggleId = useId()
  const [headerContent, setHeaderContent] = useState<ReactNode | null>(null)
  const [sidebarContent, setSidebarContent] = useState<ReactNode | null>(null)
  const [reportType, setReportTypeState] = useState<ManagerShellReportType>(
    () => readStoredReportType(),
  )
  const [queueCount, setQueueCount] = useState<number | null>(null)
  const breadcrumbs = useMemo(() => getBreadcrumbs(pathname), [pathname])

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
              <StudioReportSwitcher />

              <nav className="design-system-shell-nav" aria-label="Primary">
                {navItems.map((item) => {
                  const Icon = item.icon
                  const isActive = isActiveRoute(pathname, item.href)

                  return (
                    <Link
                      key={item.key}
                      href={item.href}
                      className={isActive ? "is-active" : undefined}
                      {...(isActive ? { "aria-current": "page" as const } : {})}
                    >
                      <Icon size={19} aria-hidden="true" />
                      <span>{item.label}</span>
                      {item.key === "jobs" &&
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
