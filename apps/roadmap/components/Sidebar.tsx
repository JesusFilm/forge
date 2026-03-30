"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import type { Lane } from "@/lib/features"

const LANE_LABELS: Record<Lane, string> = {
  "content-discovery": "Content Discovery",
  "topic-experiences": "Topic Experiences",
  "media-generation": "Media Generation",
  platform: "Platform",
}

const ALL_LANES: Lane[] = [
  "content-discovery",
  "topic-experiences",
  "media-generation",
  "platform",
]

export default function Sidebar({
  owners,
  ownerAvatars,
}: {
  owners: string[]
  ownerAvatars: Record<string, string | null>
}) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  const close = () => setOpen(false)

  const linkClass = (href: string) =>
    `block rounded px-2 py-1.5 transition-colors ${
      pathname === href
        ? "bg-gray-800 text-white"
        : "text-gray-300 hover:bg-gray-800 hover:text-white"
    }`

  const nav = (
    <nav className="flex flex-1 flex-col gap-6 overflow-y-auto text-sm">
      <div>
        <Link href="/" className={linkClass("/")} onClick={close}>
          Dashboard
        </Link>
      </div>

      <div>
        <h3 className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
          Lanes
        </h3>
        {ALL_LANES.map((lane) => (
          <Link
            key={lane}
            href={`/lane/${lane}`}
            className={linkClass(`/lane/${lane}`)}
            onClick={close}
          >
            {LANE_LABELS[lane]}
          </Link>
        ))}
      </div>

      <div>
        <h3 className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
          People
        </h3>
        {owners.map((owner) => (
          <Link
            key={owner}
            href={`/person/${owner}`}
            className={`flex items-center gap-2 capitalize ${linkClass(`/person/${owner}`)}`}
            onClick={close}
          >
            {ownerAvatars[owner] ? (
              <img
                src={`${ownerAvatars[owner]}&s=32`}
                alt={owner}
                className="h-4 w-4 rounded-full bg-white"
              />
            ) : (
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-gray-700 text-[9px] font-medium uppercase text-gray-400">
                {owner[0]}
              </span>
            )}
            {owner}
          </Link>
        ))}
      </div>
      <div className="mt-auto pt-4 border-t border-gray-800">
        <Link href="/about" className={linkClass("/about")} onClick={close}>
          About
        </Link>
      </div>
    </nav>
  )

  return (
    <>
      {/* Mobile header bar */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-12 items-center border-b border-[var(--color-border)] bg-[var(--color-card)] px-4 md:hidden">
        <button
          onClick={() => setOpen(!open)}
          className="mr-3 text-gray-300 hover:text-white"
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
        <Link
          href="/"
          className="text-sm font-bold tracking-tight"
          onClick={close}
        >
          JFP DS AI Roadmap
        </Link>
      </div>

      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={close}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 z-50 flex h-screen w-56 flex-col border-r border-[var(--color-border)] bg-[var(--color-card)] p-4 transition-transform md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Link href="/" className="mb-6 block" onClick={close}>
          <img
            src="/jesusfilm-sign.svg"
            alt="Jesus Film Project"
            className="h-6"
          />
          <span className="mt-1 block text-xs text-gray-400">
            DS AI Roadmap
          </span>
        </Link>
        {nav}
      </aside>
    </>
  )
}
