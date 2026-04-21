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
import { Button } from "@/components/ui/button"
import {
  SegmentedControl,
  SegmentedControlButton,
} from "@/components/ui/segmented-control"
import { cn } from "@/lib/utils"
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
  setSidebarContent: (content: ReactNode | null) => void
  setMode: (mode: ManagerShellMode) => void
  setReportType: (reportType: ManagerShellReportType) => void
}

const MODE_STORAGE_KEY = "forge-coverage-mode"
const REPORT_STORAGE_KEY = "forge-coverage-report"
const SIDEBAR_COLLAPSED_KEY = "forge-manager-sidebar-collapsed"

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

function readStoredSidebarCollapsed() {
  if (typeof window === "undefined") {
    return false
  }

  try {
    return window.sessionStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1"
  } catch {
    return false
  }
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
  className,
}: {
  icon: LucideIcon
  className?: string
}) {
  return (
    <Icon aria-hidden="true" className={cn("size-5 shrink-0", className)} />
  )
}

function StudioBrand({
  collapsed = false,
  mobile = false,
}: {
  collapsed?: boolean
  mobile?: boolean
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-4",
        collapsed && !mobile && "justify-center",
      )}
    >
      <Image
        alt=""
        aria-hidden="true"
        className="h-[22px] w-[31px] shrink-0"
        height={22}
        src="/jesusfilm-sign.svg"
        width={31}
      />

      {!collapsed || mobile ? (
        <>
          <span
            className={cn(
              "text-[44px] font-semibold leading-none tracking-[-0.4px] text-foreground",
              mobile && "text-[40px] text-foreground",
            )}
          >
            Studio
          </span>
          {mobile ? (
            <span
              aria-label="Alpha"
              className="inline-flex size-4 shrink-0 rounded-full bg-[var(--ds-success)]"
            />
          ) : (
            <span className="inline-flex h-9 items-center rounded-full border border-[color:color-mix(in_srgb,white_55%,transparent)] px-4 text-[12px] font-medium uppercase tracking-[0.06em] text-foreground/82">
              Alpha
            </span>
          )}
        </>
      ) : null}
    </div>
  )
}

function StudioReportSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const shell = useManagerShellState()
  const [isOpen, setIsOpen] = useState(false)
  const switcherRef = useRef<HTMLDivElement | null>(null)
  const selectedReport =
    reportOptions.find((option) => option.value === shell.reportType) ??
    reportOptions[0]

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false)
      }
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (
        switcherRef.current &&
        !switcherRef.current.contains(event.target as Node)
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
    <div className="relative" ref={switcherRef}>
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-3 rounded-[1.25rem] border border-border bg-card shadow-[0_10px_24px_rgba(8,8,8,0.05)] transition-[border-color,box-shadow,transform] duration-200 hover:border-[var(--ds-line-strong)] focus-visible:border-black focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-black/10 active:scale-[0.995]",
          collapsed
            ? "size-12 justify-center px-0 py-0"
            : "px-4 py-3 text-left",
        )}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`Current report: ${selectedReport.label}`}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <ReportIcon
          icon={selectedReport.icon}
          className="size-4 text-foreground"
        />
        {!collapsed ? (
          <span className="min-w-0 flex-1">
            <strong className="block truncate text-[16px] font-semibold leading-5 tracking-[-0.02em] text-foreground">
              {selectedReport.label}
            </strong>
            <small className="mt-0.5 block truncate text-[13px] font-normal leading-5 text-muted-foreground">
              {selectedReport.subtitle}
            </small>
          </span>
        ) : null}
        {!collapsed ? (
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-5 shrink-0 text-foreground transition-transform duration-200",
              isOpen && "rotate-180",
            )}
          />
        ) : null}
      </button>

      {isOpen ? (
        <div
          className={cn(
            "absolute z-30 overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-[0_24px_56px_rgba(8,8,8,0.12)]",
            collapsed
              ? "left-full top-0 ml-4 w-[20rem]"
              : "left-0 top-full mt-2.5 w-full min-w-[18rem]",
          )}
          role="listbox"
          aria-label="Report selector"
        >
          <div className="p-2">
            {reportOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={cn(
                  "flex w-full items-start gap-3 rounded-[1.125rem] px-3.5 py-2.5 text-left transition-colors duration-150 hover:bg-accent",
                  option.value === selectedReport.value && "bg-secondary",
                )}
                role="option"
                aria-selected={option.value === selectedReport.value}
                onClick={() => {
                  shell.setReportType(option.value)
                  setIsOpen(false)
                }}
              >
                <ReportIcon
                  icon={option.icon}
                  className="mt-0.5 size-4 text-foreground"
                />
                <span className="min-w-0 flex-1">
                  <strong className="block text-[15px] font-semibold leading-5 tracking-[-0.02em] text-foreground">
                    {option.label}
                  </strong>
                  <small className="block text-[13px] leading-5 text-muted-foreground">
                    {option.subtitle}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function StudioUserMenu({ user }: { user: ManagerShellUser }) {
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

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

  const menuItemClassName =
    "flex w-full items-center gap-3 rounded-[0.95rem] px-3.5 py-2.5 text-left text-[14px] font-medium tracking-[-0.01em] text-foreground transition-colors hover:bg-accent"

  return (
    <div className="relative" ref={menuRef}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className={cn(
          "size-10 rounded-[1.25rem] border-border shadow-none",
          menuOpen && "bg-secondary",
        )}
        aria-label="Open user menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <UserRound className="size-5" aria-hidden="true" />
      </Button>

      {menuOpen ? (
        <div className="absolute right-0 top-full z-30 mt-3 w-[20rem] overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-[0_24px_56px_rgba(8,8,8,0.14)]">
          <div className="border-b border-border p-3.5">
            <div className="rounded-[1.125rem] border border-border bg-secondary/35 p-3.5">
              <strong className="block text-[16px] font-semibold tracking-[-0.02em] text-foreground">
                {user.username}
              </strong>
              <span className="mt-1 block text-[13px] leading-5 text-muted-foreground">
                {user.email}
              </span>
            </div>
          </div>

          <div className="border-b border-border p-2.5">
            <button type="button" className={menuItemClassName}>
              <Settings2 className="size-4" aria-hidden="true" />
              Workspace settings
            </button>
            <button type="button" className={menuItemClassName}>
              <KeyRound className="size-4" aria-hidden="true" />
              Manager API keys
            </button>
            <button type="button" className={menuItemClassName}>
              <ShieldCheck className="size-4" aria-hidden="true" />
              Access and permissions
            </button>
            <Link href="/dashboard/design-system" className={menuItemClassName}>
              <LayoutTemplate className="size-4" aria-hidden="true" />
              Design system
            </Link>
          </div>

          <div className="border-b border-border p-2.5">
            <button type="button" className={menuItemClassName}>
              <FileJson2 className="size-4" aria-hidden="true" />
              <span className="flex-1">Docs and resources</span>
              <ChevronRight className="size-4" aria-hidden="true" />
            </button>
            <button type="button" className={menuItemClassName}>
              <ExternalLink className="size-4" aria-hidden="true" />
              <span className="flex-1">Terms and privacy</span>
              <ChevronRight className="size-4" aria-hidden="true" />
            </button>
          </div>

          <div className="p-2.5">
            <button
              type="button"
              className={cn(menuItemClassName, "text-destructive")}
              onClick={handleLogout}
            >
              <LogOut className="size-4" aria-hidden="true" />
              Sign out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function DesktopNav({
  pathname,
  queueCount,
  collapsed,
}: {
  pathname: string
  queueCount: number | null
  collapsed: boolean
}) {
  return (
    <nav className="flex flex-col gap-3" aria-label="Primary">
      {navItems.map((item) => {
        const Icon = item.icon
        const isActive = isActiveRoute(pathname, item.href)

        return (
          <Link
            key={item.key}
            href={item.href}
            title={item.label}
            className={cn(
              "group flex min-h-12 items-center gap-3 rounded-[1.125rem] px-4 text-[15px] font-medium tracking-[-0.01em] text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground",
              isActive && "bg-secondary text-foreground",
              collapsed && "justify-center px-0",
            )}
            {...(isActive ? { "aria-current": "page" as const } : {})}
          >
            <Icon
              className={cn(
                "size-5 shrink-0 text-muted-foreground transition-colors duration-150",
                isActive && "text-[var(--ds-brand-red)]",
                !isActive && "group-hover:text-foreground",
              )}
              aria-hidden="true"
            />
            {!collapsed ? (
              <span className="min-w-0 flex-1">{item.label}</span>
            ) : null}
            {!collapsed &&
            item.key === "jobs" &&
            queueCount != null &&
            queueCount > 0 ? (
              <span className="inline-flex min-w-8 items-center justify-center rounded-full border border-border bg-card px-2 py-1 text-[12px] font-semibold text-foreground">
                {queueCount}
              </span>
            ) : null}
          </Link>
        )
      })}
    </nav>
  )
}

function MobileNav({ pathname }: { pathname: string }) {
  return (
    <nav className="flex items-center gap-3" aria-label="Primary">
      {navItems.map((item) => {
        const Icon = item.icon
        const isActive = isActiveRoute(pathname, item.href)

        return (
          <Link
            key={item.key}
            href={item.href}
            aria-label={item.label}
            className={cn(
              "inline-flex size-12 items-center justify-center rounded-[1.125rem] text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground",
              isActive && "bg-secondary text-[var(--ds-brand-red)]",
            )}
            {...(isActive ? { "aria-current": "page" as const } : {})}
          >
            <Icon className="size-5" aria-hidden="true" />
          </Link>
        )
      })}
    </nav>
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
  const [headerContent, setHeaderContent] = useState<ReactNode | null>(null)
  const [sidebarContent, setSidebarContent] = useState<ReactNode | null>(null)
  const [mode, setModeState] = useState<ManagerShellMode>(() =>
    readStoredMode(),
  )
  const [reportType, setReportTypeState] = useState<ManagerShellReportType>(
    () => readStoredReportType(),
  )
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    readStoredSidebarCollapsed(),
  )
  const [queueCount, setQueueCount] = useState<number | null>(null)
  const breadcrumbs = useMemo(() => getBreadcrumbs(pathname), [pathname])

  const setMode = useCallback((nextMode: ManagerShellMode) => {
    setModeState(nextMode)

    try {
      window.sessionStorage.setItem(MODE_STORAGE_KEY, nextMode)
    } catch {
      // ignore storage errors
    }
  }, [])

  const setReportType = useCallback(
    (nextReportType: ManagerShellReportType) => {
      setReportTypeState(nextReportType)

      try {
        window.sessionStorage.setItem(REPORT_STORAGE_KEY, nextReportType)
      } catch {
        // ignore storage errors
      }
    },
    [],
  )

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((current) => {
      const next = !current

      try {
        window.sessionStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0")
      } catch {
        // ignore storage errors
      }

      return next
    })
  }, [])

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
      setSidebarContent,
      setMode,
      setReportType,
    }),
    [mode, reportType, setMode, setReportType],
  )

  return (
    <ManagerShellContext.Provider value={contextValue}>
      <main className="min-h-screen bg-background text-foreground">
        <section
          aria-label="Studio dashboard shell"
          className={cn(
            "min-h-screen lg:grid",
            sidebarCollapsed
              ? "lg:grid-cols-[6.5rem_minmax(0,1fr)]"
              : "lg:grid-cols-[20rem_minmax(0,1fr)]",
          )}
        >
          <aside
            aria-label="Primary"
            className={cn(
              "hidden border-r border-border bg-background lg:flex lg:min-h-screen lg:flex-col lg:gap-6 lg:py-6",
              sidebarCollapsed ? "lg:px-4" : "lg:px-5",
            )}
          >
            <div className="flex items-center">
              <StudioBrand collapsed={sidebarCollapsed} />
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-5">
              <StudioReportSwitcher collapsed={sidebarCollapsed} />
              <DesktopNav
                collapsed={sidebarCollapsed}
                pathname={pathname}
                queueCount={queueCount}
              />
            </div>

            {!sidebarCollapsed && sidebarContent ? (
              <div className="pb-2">{sidebarContent}</div>
            ) : null}
          </aside>

          <div className="flex min-h-screen min-w-0 flex-col">
            <div className="border-b border-border bg-background lg:hidden">
              <div className="space-y-4 px-5 py-5 sm:px-7">
                <div className="flex items-center justify-between gap-4">
                  <StudioBrand mobile />
                  <MobileNav pathname={pathname} />
                </div>

                <StudioReportSwitcher />
              </div>
            </div>

            <header className="border-b border-border bg-background/95 px-5 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/88 sm:px-7 lg:px-8">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="min-w-0 flex-1 space-y-4">
                  <div className="flex min-w-0 items-center gap-4">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="hidden size-10 rounded-[1.25rem] border-border shadow-none lg:inline-flex"
                      aria-label={
                        sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
                      }
                      onClick={toggleSidebar}
                    >
                      <PanelLeft className="size-5" aria-hidden="true" />
                    </Button>

                    <nav
                      className="flex min-w-0 flex-wrap items-center gap-2.5 text-[15px] font-medium tracking-[-0.01em] text-muted-foreground sm:text-[16px]"
                      aria-label="Breadcrumb"
                    >
                      {breadcrumbs.map((crumb, index) => (
                        <span
                          className="flex min-w-0 items-center gap-2.5"
                          key={crumb}
                        >
                          {index > 0 ? (
                            <ChevronRight
                              className="size-4 shrink-0 text-muted-foreground"
                              aria-hidden="true"
                            />
                          ) : null}
                          {index === breadcrumbs.length - 1 ? (
                            <strong className="truncate text-foreground">
                              {crumb}
                            </strong>
                          ) : (
                            <span className="truncate">{crumb}</span>
                          )}
                        </span>
                      ))}
                    </nav>
                  </div>

                  {headerContent ? (
                    <div className="min-w-0">{headerContent}</div>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <SegmentedControl>
                    <SegmentedControlButton
                      className="px-5"
                      active={mode === "explore"}
                      onClick={() => setMode("explore")}
                    >
                      Explore
                    </SegmentedControlButton>
                    <SegmentedControlButton
                      className="px-5"
                      active={mode === "select"}
                      onClick={() => setMode("select")}
                    >
                      Select
                    </SegmentedControlButton>
                  </SegmentedControl>

                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-10 rounded-[1.25rem] border-border shadow-none"
                    aria-label="Notifications"
                  >
                    <Bell className="size-5" aria-hidden="true" />
                  </Button>

                  <StudioUserMenu user={user} />
                </div>
              </div>
            </header>

            <div className="flex-1 px-5 py-6 sm:px-7 sm:py-8 lg:px-8 lg:py-9">
              <div className="min-w-0">
                <div className="pb-6 lg:hidden">{sidebarContent}</div>
                {children}
              </div>
            </div>
          </div>
        </section>
      </main>
    </ManagerShellContext.Provider>
  )
}
