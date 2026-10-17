"use client"

// Header chip that shows the current role and opens a small menu to switch
// it, plus one role-specific shortcut. Markup and classes are copied from the
// prototype (prototype-parity manifest). It renders only while a page's
// audience frame is registered (flag on, configuration accepted); roles and
// the shortcut come from that configuration — the shortcut is the role's
// first action this header can serve (canonical route or reviewed resource).

import type { Route } from "next"
import { Check, ChevronDown } from "lucide-react"
import Link from "next/link"
import { useEffect, useId, useRef, useState } from "react"

import { setWatchRole, useWatchRole } from "@/components/watch/watch-role"
import {
  resolveWatchAudienceDestination,
  watchAudienceActionIcon,
} from "@/components/watch/watch-audience-actions"
import { useWatchAudiencePresence } from "@/components/watch/watch-audience-presence"
import { WATCH_ROLE_ICON as ROLE_ICON } from "@/components/watch/WatchRoleTabs"
import { tryAsLocaleSlug } from "@/lib/routes"
import { cn } from "@/lib/utils"
import { getWatchAudienceRole } from "@/lib/watch-audience-config"

export function WatchRoleChip() {
  const presence = useWatchAudiencePresence()
  return presence ? (
    <WatchRoleChipMenu
      config={presence.config}
      languageSlug={presence.languageSlug}
    />
  ) : null
}

function WatchRoleChipMenu({
  config,
  languageSlug,
}: {
  config: import("@/lib/watch-audience-config").WatchAudienceConfig
  languageSlug: string | null
}) {
  const WATCH_ROLES = config.roles
  const { role, hydrated } = useWatchRole()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const current = WATCH_ROLES.find((r) => r.id === role) ?? WATCH_ROLES[0]
  const Icon = ROLE_ICON[role]
  const lang = tryAsLocaleSlug(languageSlug ?? "english")

  // The header has no current video, so page controls are never offered.
  const s =
    (getWatchAudienceRole(config, role)?.actions ?? []).flatMap((action) => {
      const destination = resolveWatchAudienceDestination(
        action.target,
        lang,
        {},
      )
      if (!destination || destination.kind === "control") return []
      return [
        {
          Icon: watchAudienceActionIcon(action.target),
          label: action.title,
          href: destination.href,
          external: destination.kind === "resource",
        },
      ]
    })[0] ?? null

  return (
    <div
      ref={rootRef}
      className={cn(
        "pointer-events-auto relative hidden transition-opacity duration-300 xl:block",
        hydrated ? "opacity-100" : "opacity-0",
      )}
      data-testid="watch-role-chip"
      data-role={role}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        title="Who is this for?"
        className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border border-white/20 bg-white/8 px-3 text-stone-100 backdrop-blur-md transition-colors hover:bg-white/14 hover:text-white focus-visible:ring-2 focus-visible:ring-stone-300 focus-visible:outline-none md:h-[44px] md:px-3 min-[1700px]:px-3.5"
      >
        <Icon
          aria-hidden
          className="size-5 shrink-0 drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.35)]"
        />
        <span className="hidden text-sm font-semibold whitespace-nowrap drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.35)] min-[1700px]:inline">
          {current.chip}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "hidden size-4 shrink-0 opacity-70 transition-transform min-[1700px]:inline",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Who is this for?"
          className="absolute top-[calc(100%+8px)] right-0 z-50 w-[300px] overflow-hidden rounded-2xl border border-white/15 bg-stone-950/95 p-1.5 text-stone-100 shadow-[0_24px_60px_rgba(0,0,0,.6)] backdrop-blur-xl"
        >
          <p className="px-3 pt-2 pb-1.5 text-[11px] font-semibold tracking-[0.14em] text-red-100/70 uppercase">
            Who is this for?
          </p>
          {WATCH_ROLES.map((r) => {
            const RIcon = ROLE_ICON[r.id]
            const selected = r.id === role
            return (
              <button
                key={r.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  setWatchRole(r.id)
                  setOpen(false)
                }}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/8 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none",
                  selected && "bg-white/8",
                )}
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/8">
                  <RIcon aria-hidden className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{r.chip}</span>
                  <span className="block text-xs text-stone-400">
                    {r.label} · {r.hint}
                  </span>
                </span>
                {selected ? (
                  <Check aria-hidden className="size-4 shrink-0" />
                ) : null}
              </button>
            )
          })}
          {s ? (
            <div className="mx-1.5 my-1.5 border-t border-white/10" />
          ) : null}
          {!s ? null : s.external ? (
            <a
              role="menuitem"
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-xl bg-brand-red px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#d92a36] focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
            >
              <s.Icon aria-hidden className="size-4 shrink-0" />
              {s.label}
            </a>
          ) : (
            <Link
              role="menuitem"
              href={s.href as Route}
              prefetch={false}
              className="flex items-center gap-3 rounded-xl bg-brand-red px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#d92a36] focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
            >
              <s.Icon aria-hidden className="size-4 shrink-0" />
              {s.label}
            </Link>
          )}
        </div>
      ) : null}
    </div>
  )
}
