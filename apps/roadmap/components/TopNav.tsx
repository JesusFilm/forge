"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/experiments", label: "Experiments" },
  { href: "/dashboard", label: "Dashboard" },
]

export default function TopNav() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  const close = () => setOpen(false)

  const linkClass = (href: string) => {
    const active = href === "/" ? pathname === "/" : pathname.startsWith(href)
    return `block rounded px-3 py-1.5 text-sm transition-colors ${
      active
        ? "bg-gray-800 text-white"
        : "text-gray-300 hover:bg-gray-800 hover:text-white"
    }`
  }

  return (
    <>
      <header className="border-b border-[var(--color-border)] bg-[var(--color-card)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 md:px-8">
          <Link href="/" className="flex items-center gap-2" onClick={close}>
            <img
              src="/jesusfilm-sign.svg"
              alt="Jesus Film Project"
              className="h-5 shrink-0"
            />
            <span className="text-sm font-semibold text-gray-300">
              DS AI Roadmap
            </span>
          </Link>

          {/* Desktop links */}
          <nav className="hidden gap-1 md:flex">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={linkClass(link.href)}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Mobile hamburger */}
          <button
            onClick={() => setOpen(!open)}
            className="cursor-pointer text-gray-300 hover:text-white md:hidden"
            aria-label="Toggle menu"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              {open ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 6h16M4 12h16M4 18h16"
                />
              )}
            </svg>
          </button>
        </div>
      </header>

      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={close}
        />
      )}

      {/* Mobile slide-out panel — from right */}
      <aside
        className={`fixed right-0 top-0 z-50 flex h-screen w-56 flex-col border-l border-[var(--color-border)] bg-[var(--color-card)] p-4 transition-transform md:hidden ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <Link href="/" className="mb-6 flex items-center gap-2" onClick={close}>
          <img
            src="/jesusfilm-sign.svg"
            alt="Jesus Film Project"
            className="h-5 shrink-0"
          />
          <span className="text-sm font-semibold text-gray-300">
            DS AI Roadmap
          </span>
        </Link>
        <nav className="flex flex-col gap-1">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={linkClass(link.href)}
              onClick={close}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </aside>
    </>
  )
}
