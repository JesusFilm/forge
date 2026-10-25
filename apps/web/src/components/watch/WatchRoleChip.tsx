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
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react"

import { setWatchRole, useWatchRole } from "@/components/watch/watch-role"
import {
  resolveWatchAudienceDestination,
  watchAudienceActionIcon,
} from "@/components/watch/watch-audience-actions"
import { useWatchAudiencePresence } from "@/components/watch/watch-audience-presence"
import { WATCH_ROLE_ICON as ROLE_ICON } from "@/components/watch/WatchRoleTabs"
import { tryAsLocaleSlug } from "@/lib/routes"
import { textDirectionForLocale } from "@/lib/locale"
import { cn } from "@/lib/utils"
import { getWatchAudienceRole } from "@/lib/watch-audience-config"

export function WatchRoleChip() {
  const presence = useWatchAudiencePresence()
  return presence ? (
    <WatchRoleChipMenu
      config={presence.config}
      languageSlug={presence.languageSlug}
      sourceLocale={presence.sourceLocale}
    />
  ) : null
}

function WatchRoleChipMenu({
  config,
  languageSlug,
  sourceLocale,
}: {
  config: import("@/lib/watch-audience-config").WatchAudienceConfig
  languageSlug: string | null
  sourceLocale: string | null
}) {
  const WATCH_ROLES = config.roles
  const { role, hydrated } = useWatchRole()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const openingEdge = useRef<"first" | "last">("first")
  const menuId = useId()
  const triggerId = `${menuId}-trigger`
  const labelId = `${menuId}-label`
  const chipId = `${menuId}-chip`
  const contentBoundary = {
    lang: sourceLocale ?? "",
    dir: sourceLocale ? textDirectionForLocale(sourceLocale) : "auto",
  } as const

  function menuItems() {
    return Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ??
        [],
    )
  }

  function closeAndRestoreFocus() {
    triggerRef.current?.focus()
    setOpen(false)
  }

  function openAt(edge: "first" | "last") {
    openingEdge.current = edge
    if (open) {
      const items = menuItems()
      const target = edge === "first" ? items[0] : items.at(-1)
      target?.focus()
    } else setOpen(true)
  }

  function navigateMenu(event: KeyboardEvent<HTMLDivElement>) {
    const items = menuItems()
    const index = items.indexOf(document.activeElement as HTMLElement)
    let next: number
    switch (event.key) {
      case "ArrowDown":
        next = (index + 1) % items.length
        break
      case "ArrowUp":
        next = (index - 1 + items.length) % items.length
        break
      case "Home":
        next = 0
        break
      case "End":
        next = items.length - 1
        break
      case "Escape":
        event.preventDefault()
        event.stopPropagation()
        closeAndRestoreFocus()
        return
      case "Tab":
        // Let native Tab/Shift+Tab continue from the trigger's position in
        // the page. Menu items are managed focus targets, not extra tab stops.
        closeAndRestoreFocus()
        return
      default: {
        if (
          event.key.length !== 1 ||
          event.key === " " ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        )
          return
        const ordered = [
          ...items.slice(index + 1),
          ...items.slice(0, index + 1),
        ]
        const match = ordered.find((item) =>
          item.textContent
            ?.trim()
            .toLowerCase()
            .startsWith(event.key.toLowerCase()),
        )
        if (match) {
          event.preventDefault()
          match.focus()
        }
        return
      }
    }
    event.preventDefault()
    items[next]?.focus()
  }

  useEffect(() => {
    if (!open) return
    const items =
      menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]')
    const first = items?.[0]
    const last = items?.[items.length - 1]
    const target = openingEdge.current === "first" ? first : last
    target?.focus()
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("pointerdown", onDown)
    return () => {
      document.removeEventListener("pointerdown", onDown)
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
      lang="en"
      dir="ltr"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
      className={cn(
        "pointer-events-auto relative hidden transition-opacity duration-300 xl:block",
        hydrated ? "opacity-100" : "opacity-0",
      )}
      data-testid="watch-role-chip"
      data-role={role}
    >
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-labelledby={`${labelId} ${chipId}`}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault()
            openAt(event.key === "ArrowDown" ? "first" : "last")
          } else if (event.key === "Escape" && open) {
            event.preventDefault()
            closeAndRestoreFocus()
          }
        }}
        onClick={() => (open ? closeAndRestoreFocus() : openAt("first"))}
        title="Who is this for?"
        className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border border-white/20 bg-white/8 px-3 text-stone-100 backdrop-blur-md transition-colors hover:bg-white/14 hover:text-white focus-visible:ring-2 focus-visible:ring-stone-300 focus-visible:outline-none md:h-[44px] md:px-3 min-[1700px]:px-3.5"
      >
        <Icon
          aria-hidden
          className="size-5 shrink-0 drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.35)]"
        />
        <span id={labelId} className="sr-only">
          Who is this for?
        </span>
        <span
          id={chipId}
          {...contentBoundary}
          className="hidden text-sm font-semibold whitespace-nowrap drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.35)] min-[1700px]:inline"
        >
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
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-labelledby={triggerId}
          onKeyDown={navigateMenu}
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
                tabIndex={-1}
                {...contentBoundary}
                onClick={() => {
                  setWatchRole(r.id)
                  closeAndRestoreFocus()
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
              {...contentBoundary}
              role="menuitem"
              tabIndex={-1}
              onClick={closeAndRestoreFocus}
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
              {...contentBoundary}
              role="menuitem"
              tabIndex={-1}
              onClick={closeAndRestoreFocus}
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
