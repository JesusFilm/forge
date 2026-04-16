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
  Captions,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileAudio2,
  FileJson2,
  KeyRound,
  LayoutTemplate,
  ListChecks,
  LogOut,
  PanelLeft,
  Settings2,
  ShieldCheck,
  UserRound,
} from "lucide-react"
import { apiFetch } from "@/lib/api-fetch"

export type ManagerShellUser = {
  username: string
  email: string
}

export type ManagerShellReportType = "subtitles" | "audio" | "meta"
export type ManagerShellMode = "explore" | "select"

type ManagerShellContextValue = {
  mode: ManagerShellMode
  reportType: ManagerShellReportType
  setHeaderContent: (content: ReactNode | null) => void
  setMode: (mode: ManagerShellMode) => void
  setReportType: (reportType: ManagerShellReportType) => void
}

const MODE_STORAGE_KEY = "forge-coverage-mode"
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
    key: "agents",
    href: "/dashboard/agents",
    label: "Agents",
    icon: Bot,
  },
  {
    key: "design-system",
    href: "/dashboard/design-system",
    label: "System",
    icon: LayoutTemplate,
  },
]

function readStoredMode(): ManagerShellMode {
  if (typeof window === "undefined") {
    return "explore"
  }

  try {
    const stored = window.sessionStorage.getItem(MODE_STORAGE_KEY)
    if (stored === "explore" || stored === "select") {
      return stored
    }
  } catch {
    // ignore storage errors
  }

  return "explore"
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
  if (pathname.startsWith("/dashboard/jobs/")) {
    return ["Studio", "Jobs", "Job detail"]
  }

  if (pathname.startsWith("/dashboard/jobs")) {
    return ["Studio", "Jobs"]
  }

  if (pathname.startsWith("/dashboard/agents")) {
    return ["Studio", "Agents"]
  }

  if (pathname.startsWith("/dashboard/design-system")) {
    return ["Studio", "Design system"]
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
    <div
      className={`design-system-user-menu${menuOpen ? " is-open" : ""}`}
      ref={menuRef}
    >
      <button
        type="button"
        className="design-system-user-trigger"
        aria-label="Open user menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span className="design-system-user-trigger-avatar">
          <UserRound size={16} aria-hidden="true" />
        </span>
      </button>

      {menuOpen ? (
        <div className="design-system-user-menu-panel">
          <section className="design-system-user-menu-card">
            <div className="design-system-user-menu-balance">
              <div>
                <strong>{user.username}</strong>
                <span>{user.email}</span>
              </div>
              <button className="design-system-button is-primary" type="button">
                Workspace
              </button>
            </div>
          </section>

          <div className="design-system-user-menu-group">
            <button type="button">
              <Settings2 size={16} aria-hidden="true" />
              Workspace settings
            </button>
            <button type="button">
              <KeyRound size={16} aria-hidden="true" />
              Manager API keys
            </button>
            <button type="button">
              <ShieldCheck size={16} aria-hidden="true" />
              Access and permissions
            </button>
            <button type="button">
              <LayoutTemplate size={16} aria-hidden="true" />
              Design system
            </button>
          </div>

          <div className="design-system-user-menu-group">
            <button type="button">
              <FileJson2 size={16} aria-hidden="true" />
              Docs and resources
              <ChevronRight size={16} aria-hidden="true" />
            </button>
            <button type="button">
              <ExternalLink size={16} aria-hidden="true" />
              Terms and privacy
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>

          <div className="design-system-user-menu-group">
            <button type="button" onClick={handleLogout}>
              <LogOut size={16} aria-hidden="true" />
              Sign out
            </button>
          </div>
        </div>
      ) : null}
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
  const [mode, setModeState] = useState<ManagerShellMode>(() =>
    readStoredMode(),
  )
  const [reportType, setReportTypeState] = useState<ManagerShellReportType>(
    () => readStoredReportType(),
  )
  const [queueCount, setQueueCount] = useState<number | null>(null)
  const breadcrumbs = useMemo(() => getBreadcrumbs(pathname), [pathname])

  const setMode = useCallback((nextMode: ManagerShellMode) => {
    setModeState(nextMode)

    if (typeof window === "undefined") {
      return
    }

    try {
      window.sessionStorage.setItem(MODE_STORAGE_KEY, nextMode)
    } catch {
      // ignore storage errors
    }
  }, [])

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
      mode,
      reportType,
      setHeaderContent,
      setMode,
      setReportType,
    }),
    [mode, reportType, setMode, setReportType],
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
                <div
                  className="design-system-segmented design-system-topbar-switch"
                  role="tablist"
                  aria-label="Workspace mode"
                >
                  <button
                    type="button"
                    className={mode === "explore" ? "is-active" : undefined}
                    onClick={() => setMode("explore")}
                  >
                    Explore
                  </button>
                  <button
                    type="button"
                    className={mode === "select" ? "is-active" : undefined}
                    onClick={() => setMode("select")}
                  >
                    Select
                  </button>
                </div>

                <button type="button" aria-label="Notifications">
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
