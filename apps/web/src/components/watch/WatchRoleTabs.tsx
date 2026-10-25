"use client"

// The four large role tabs shared by the Watch home and the video page's
// "What's next" zone. Markup and classes are copied from the prototype
// (prototype-parity manifest); only the role list (published config), the
// tab/panel ids and roving arrow/Home/End keys are wired on top.

import { Compass, Send, Sprout, Users, type LucideIcon } from "lucide-react"
import { useRef, type KeyboardEvent } from "react"

import {
  setWatchRole,
  useWatchRole,
  type WatchRole,
} from "@/components/watch/watch-role"
import {
  WATCH_AUDIENCE_CODE_CONFIG,
  type WatchAudienceConfig,
} from "@/lib/watch-audience-config"
import { textDirectionForLocale } from "@/lib/locale"
import { cn } from "@/lib/utils"

export const WATCH_ROLE_ICON: Record<WatchRole, LucideIcon> = {
  explore: Compass,
  grow: Sprout,
  share: Send,
  partner: Users,
}

/** Tab and panel ids for one frame; `idBase` comes from the host's `useId()`. */
export function watchRoleTabId(idBase: string, role: WatchRole) {
  return `${idBase}-tab-${role}`
}

export function watchRolePanelId(idBase: string) {
  return `${idBase}-panel`
}

/** The ARIA wiring the host puts on its own `role="tabpanel"` element. */
export function watchRolePanelProps(idBase: string, role: WatchRole) {
  return {
    id: watchRolePanelId(idBase),
    role: "tabpanel",
    "aria-labelledby": watchRoleTabId(idBase, role),
    tabIndex: 0,
  } as const
}

export function WatchRoleTabs({
  className,
  label = "Who is this for",
  labelLocale = "en",
  locale = "en",
  onSelect,
  idBase,
  config = WATCH_AUDIENCE_CODE_CONFIG,
}: {
  className?: string
  label?: string
  /** Language of a custom group name; the default chrome is English. */
  labelLocale?: string
  /** Resolved configuration language, including fallback. */
  locale?: string
  /** Fires after the role is set; lets a host open/close its panel. */
  onSelect?: (role: WatchRole, wasSelected: boolean) => void
  /** Shared with the host's tabpanel via `watchRolePanelProps`. */
  idBase: string
  config?: WatchAudienceConfig
}) {
  const { role } = useWatchRole()
  const buttons = useRef(new Map<WatchRole, HTMLButtonElement>())
  const roles = config.roles

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number
    switch (event.key) {
      case "ArrowRight":
        next = (index + 1) % roles.length
        break
      case "ArrowLeft":
        next = (index - 1 + roles.length) % roles.length
        break
      case "Home":
        next = 0
        break
      case "End":
        next = roles.length - 1
        break
      default:
        return
    }
    event.preventDefault()
    const nextRole = roles[next].id
    setWatchRole(nextRole)
    onSelect?.(nextRole, nextRole === role)
    buttons.current.get(nextRole)?.focus()
  }

  return (
    <div
      lang={labelLocale}
      dir={textDirectionForLocale(labelLocale)}
      role="tablist"
      aria-label={label}
      data-testid="watch-role-tabs"
      className={className}
    >
      {/* Keep the authored tab order/direction independent of the English group name. */}
      <div
        lang={locale}
        dir={textDirectionForLocale(locale)}
        className="grid w-full grid-cols-2 md:grid-cols-4"
      >
        {roles.map((tab, index) => {
          const selected = tab.id === role
          const TabIcon = WATCH_ROLE_ICON[tab.id]
          return (
            <button
              key={tab.id}
              ref={(node) => {
                if (node) buttons.current.set(tab.id, node)
                else buttons.current.delete(tab.id)
              }}
              id={watchRoleTabId(idBase, tab.id)}
              type="button"
              lang={locale}
              dir={textDirectionForLocale(locale)}
              role="tab"
              aria-selected={selected}
              aria-controls={watchRolePanelId(idBase)}
              tabIndex={selected ? 0 : -1}
              onKeyDown={(event) => navigate(event, index)}
              onClick={() => {
                setWatchRole(tab.id)
                onSelect?.(tab.id, selected)
              }}
              className={cn(
                // Vertical separators only: every tab, including the last, draws one
                // hairline on its RIGHT (same colour as the Related Questions rows).
                // Plus a top hairline across the strip and a left edge on the first tab of
                // each row, so the strip is closed on both sides. No bottom border.
                "group relative flex min-h-[56px] cursor-pointer items-center justify-center gap-2.5 border-t border-r border-stone-500/20 px-3 py-3 text-left transition-colors focus-visible:outline-3 focus-visible:-outline-offset-4 focus-visible:outline-[#2563eb] focus-visible:shadow-[inset_0_0_0_1px_white] md:min-h-[64px] md:gap-4 md:px-4 lg:gap-5 [&:nth-child(2n+1)]:border-l md:[&:nth-child(2n+1)]:border-l-0 md:[&:nth-child(4n+1)]:border-l",
                selected
                  ? // Selected: solid white with a small white tail pointing into the content below.
                    "z-10 border-t-white border-l-white bg-white text-stone-900 after:absolute after:top-full after:left-1/2 after:-translate-x-1/2 after:border-[9px] after:border-transparent after:border-t-white after:content-['']"
                  : "bg-transparent text-white/60 hover:bg-white/[0.04] hover:text-white/90",
              )}
            >
              <TabIcon
                aria-hidden
                className={cn(
                  "size-5 shrink-0 transition-colors",
                  selected ? "text-brand-red" : "text-current",
                )}
              />
              <span className="min-w-0">
                <span className="block text-[14px] leading-tight font-semibold sm:text-[15px] md:text-base">
                  {tab.label}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
