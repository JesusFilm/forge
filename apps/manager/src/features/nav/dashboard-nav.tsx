"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { BarChart2, Bot, ListChecks, LogOut } from "lucide-react"
import { apiFetch } from "@/lib/api-fetch"

type NavUser = { username: string; email: string }

function getInitials(username: string): string {
  const initials = username
    .split(/[\s._-]+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("")
  return initials || "U"
}

export function DashboardNav({ user }: { user: NavUser }) {
  const router = useRouter()
  const pathname = usePathname()
  const [queueCount, setQueueCount] = useState<number | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const isCoverage = pathname.startsWith("/dashboard/coverage")
  const isJobs =
    pathname.startsWith("/dashboard/jobs") || pathname === "/dashboard"
  const isAgents = pathname.startsWith("/dashboard/agents")

  useEffect(() => {
    let cancelled = false

    async function loadCount() {
      try {
        const res = await apiFetch("/api/jobs?view=count", {
          cache: "no-store",
        })
        if (!res.ok) return
        const payload = (await res.json()) as { total: number }
        if (!cancelled) setQueueCount(payload.total ?? 0)
      } catch {
        // ignore
      }
    }

    void loadCount()
    const id = window.setInterval(loadCount, 30000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  const handleLogout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" })
    router.push("/login")
    router.refresh()
  }, [router])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [menuOpen])

  return (
    <nav className="header-diagram-menu header-nav-tabs">
      <Link
        href="/dashboard/coverage"
        className={`header-nav-link${isCoverage ? " is-active" : ""}`}
        {...(isCoverage ? { "aria-current": "page" as const } : {})}
      >
        <span className="header-nav-link-icon" aria-hidden="true">
          <BarChart2 size={16} />
        </span>
        <span>Report</span>
      </Link>
      <Link
        href="/dashboard/jobs"
        className={`header-nav-link${isJobs ? " is-active" : ""}`}
        {...(isJobs ? { "aria-current": "page" as const } : {})}
      >
        <span className="header-nav-link-icon" aria-hidden="true">
          <ListChecks size={16} />
        </span>
        <span>Jobs</span>
        {queueCount !== null && queueCount > 0 && (
          <span
            className="header-nav-link-badge"
            aria-label={`${queueCount} current jobs`}
            title={`${queueCount} current jobs`}
          >
            {queueCount}
          </span>
        )}
      </Link>
      <Link
        href="/dashboard/agents"
        className={`header-nav-link${isAgents ? " is-active" : ""}`}
        {...(isAgents ? { "aria-current": "page" as const } : {})}
      >
        <span className="header-nav-link-icon" aria-hidden="true">
          <Bot size={16} />
        </span>
        <span>Agents</span>
      </Link>
      <div className="user-menu-wrap" ref={menuRef}>
        <button
          type="button"
          className="user-avatar-btn"
          onClick={() => setMenuOpen((o) => !o)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label={`User menu for ${user.username}`}
        >
          <span className="user-avatar" aria-hidden="true">
            {getInitials(user.username)}
          </span>
        </button>
        {menuOpen && (
          <div className="user-menu" role="menu">
            <div className="user-menu-info">
              <span className="user-menu-name">{user.username}</span>
              <span className="user-menu-email">{user.email}</span>
            </div>
            <div className="user-menu-divider" />
            <button
              type="button"
              className="user-menu-item"
              role="menuitem"
              onClick={handleLogout}
            >
              <LogOut size={14} aria-hidden="true" />
              Sign out
            </button>
          </div>
        )}
      </div>
    </nav>
  )
}
