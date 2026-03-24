"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { apiFetch } from "@/lib/api-fetch"
import type { JobRecord } from "@/types/job"

export function DashboardNav() {
  const router = useRouter()
  const pathname = usePathname()
  const [queueCount, setQueueCount] = useState<number | null>(null)

  const isCoverage = pathname.startsWith("/dashboard/coverage")
  const isJobs =
    pathname.startsWith("/dashboard/jobs") || pathname === "/dashboard"

  useEffect(() => {
    let cancelled = false

    async function loadCount() {
      try {
        const res = await apiFetch("/api/jobs", { cache: "no-store" })
        if (!res.ok) return
        const payload = (await res.json()) as {
          jobs: JobRecord[]
          total: number
        }
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

  return (
    <nav className="header-diagram-menu header-nav-tabs">
      <Link
        href="/dashboard/coverage"
        className={`header-nav-link${isCoverage ? " is-active" : ""}`}
        {...(isCoverage ? { "aria-current": "page" as const } : {})}
      >
        <span className="header-nav-link-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" role="presentation" focusable="false">
            <path d="M1.5 8c1.8-3 4-4.5 6.5-4.5S12.7 5 14.5 8c-1.8 3-4 4.5-6.5 4.5S3.3 11 1.5 8z" />
            <circle cx="8" cy="8" r="2.1" />
          </svg>
        </span>
        <span>Report</span>
      </Link>
      <Link
        href="/dashboard/jobs"
        className={`header-nav-link${isJobs ? " is-active" : ""}`}
        {...(isJobs ? { "aria-current": "page" as const } : {})}
      >
        <span className="header-nav-link-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" role="presentation" focusable="false">
            <path d="M3 4h6M3 8h10M3 12h8" />
          </svg>
        </span>
        <span>Queue</span>
        {queueCount !== null && (
          <span
            className="header-nav-link-badge"
            aria-label={`${queueCount} current jobs`}
            title={`${queueCount} current jobs`}
          >
            {queueCount}
          </span>
        )}
      </Link>
      <button type="button" className="header-nav-link" onClick={handleLogout}>
        <span className="header-nav-link-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" role="presentation" focusable="false">
            <path
              d="M6 2H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h2M10.5 12l3.5-4-3.5-4M14 8H6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
            />
          </svg>
        </span>
        <span>Sign out</span>
      </button>
    </nav>
  )
}
