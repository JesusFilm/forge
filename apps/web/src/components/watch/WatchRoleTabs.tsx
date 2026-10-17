"use client"

import { Compass, Send, Sprout, Users } from "lucide-react"
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react"

import {
  WATCH_AUDIENCE_CODE_CONFIG,
  type WatchAudienceConfig,
} from "@/lib/watch-audience-config"
import { cn } from "@/lib/utils"
import { setWatchRole, useWatchRole, type WatchRole } from "./watch-role"

export const WATCH_ROLE_ICON = {
  explore: Compass,
  grow: Sprout,
  share: Send,
  partner: Users,
}

export type WatchRoleTabsProps = {
  config?: WatchAudienceConfig
  label?: string
  className?: string
  children?: ReactNode
}

/** One tab list and its labelled panel; each frame owns a unique id namespace. */
export function WatchRoleTabs({
  config = WATCH_AUDIENCE_CODE_CONFIG,
  label = "Who is this for",
  className,
  children,
}: WatchRoleTabsProps) {
  const { role } = useWatchRole()
  const id = useId()
  const panelId = `${id}-panel`
  const buttons = useRef(new Map<WatchRole, HTMLButtonElement>())

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number
    switch (event.key) {
      case "ArrowRight":
        next = (index + 1) % config.roles.length
        break
      case "ArrowLeft":
        next = (index - 1 + config.roles.length) % config.roles.length
        break
      case "Home":
        next = 0
        break
      case "End":
        next = config.roles.length - 1
        break
      default:
        return
    }
    event.preventDefault()
    const nextRole = config.roles[next].id
    setWatchRole(nextRole)
    buttons.current.get(nextRole)?.focus()
  }

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={label}
        data-testid="watch-role-tabs"
        className="grid w-full grid-cols-2 md:grid-cols-4"
      >
        {config.roles.map((tab, index) => {
          const selected = tab.id === role
          const Icon = WATCH_ROLE_ICON[tab.id]
          return (
            <button
              key={tab.id}
              ref={(node) => {
                if (node) buttons.current.set(tab.id, node)
                else buttons.current.delete(tab.id)
              }}
              id={`${id}-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              onClick={() => setWatchRole(tab.id)}
              onKeyDown={(event) => navigate(event, index)}
              className={cn(
                "relative flex min-h-14 cursor-pointer items-center justify-center gap-2.5 border border-white/15 px-3 py-3 text-left text-sm font-semibold transition-colors focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 md:min-h-16 md:gap-4 md:text-base",
                selected
                  ? "z-10 border-white bg-white text-stone-900 after:absolute after:top-full after:left-1/2 after:-translate-x-1/2 after:border-8 after:border-transparent after:border-t-white after:content-['']"
                  : "text-white/70 hover:bg-white/5 hover:text-white",
              )}
            >
              <Icon
                aria-hidden="true"
                className={cn("size-5 shrink-0", selected && "text-blue-600")}
              />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>
      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${role}`}
        tabIndex={0}
        data-testid="watch-next-steps-panel"
        className="min-h-[600px] min-w-0 pt-8 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-400 sm:min-h-[420px] md:pt-10"
      >
        {children}
      </div>
    </div>
  )
}
