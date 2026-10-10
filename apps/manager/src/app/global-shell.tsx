"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useLayoutEffect } from "react"

export function shouldHideGlobalHeader(pathname: string | null): boolean {
  if (!pathname) {
    return false
  }

  return (
    pathname === "/login" ||
    pathname === "/design" ||
    pathname === "/subtitle-review" ||
    pathname.startsWith("/subtitle-review/") ||
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/")
  )
}

function shouldUseJobsStandaloneBackground(pathname: string | null): boolean {
  if (!pathname) {
    return false
  }

  return (
    pathname === "/dashboard/jobs" ||
    pathname.startsWith("/dashboard/jobs/") ||
    pathname === "/dashboard/agents"
  )
}

function shouldUseCoverageStandalone(pathname: string | null): boolean {
  if (!pathname) {
    return false
  }

  return pathname === "/dashboard/coverage"
}

export function GlobalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const hideGlobalHeader = shouldHideGlobalHeader(pathname)
  const useCoverageStandalone = shouldUseCoverageStandalone(pathname)
  const useJobsStandaloneBackground =
    shouldUseJobsStandaloneBackground(pathname)

  useLayoutEffect(() => {
    if (typeof document === "undefined") {
      return
    }

    document.body.classList.toggle("coverage-standalone", useCoverageStandalone)
    document.body.classList.toggle(
      "jobs-standalone",
      useJobsStandaloneBackground,
    )
  }, [useCoverageStandalone, useJobsStandaloneBackground])

  return (
    <>
      {!hideGlobalHeader && (
        <header className="container" style={{ paddingBottom: 0 }}>
          <div
            className="card"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <strong>AI Video Enrichment Platform</strong>
            <nav style={{ display: "flex", gap: 12 }}>
              <Link href="/dashboard/jobs">Jobs</Link>
              <Link href="/dashboard/coverage">Coverage</Link>
              <Link href="/login">Logout</Link>
            </nav>
          </div>
        </header>
      )}
      {children}
    </>
  )
}
