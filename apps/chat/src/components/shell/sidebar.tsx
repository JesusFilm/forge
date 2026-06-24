"use client"

import { useEffect, useRef, useState } from "react"

import { BrandLockup } from "@/components/brand/brand-lockup"
import { cn } from "@/lib/cn"
import { type Conversation } from "@/lib/conversations"

import { CloseIcon, ComposeIcon, PanelIcon } from "./icons"

type SidebarProps = {
  conversations: Conversation[]
  activeId: string
  pendingIds: ReadonlySet<string>
  collapsed: boolean
  mobileOpen: boolean
  onNew: () => void
  onSelect: (id: string) => void
  onToggleCollapsed: () => void
  onCloseMobile: () => void
}

// Stable id so the mobile trigger can reference the drawer via aria-controls.
export const SIDEBAR_ID = "app-sidebar"

/**
 * Left rail modeled on Gemini's sidebar, with three presentations from two
 * independent flags: desktop expanded (brand + conversation list), desktop
 * collapsed (icon-only column; hovering the mark reveals an "Open sidebar"
 * toggle), and the mobile off-canvas drawer (slides in over a scrim, X to
 * close). Collapse is desktop-only — every collapsed style is `md:`-scoped, so
 * the drawer always shows full content. A brand extension built from the Vigil
 * tokens, not copied from the (single-surface) Vigil system.
 */
export function Sidebar({
  conversations,
  activeId,
  pendingIds,
  collapsed,
  mobileOpen,
  onNew,
  onSelect,
  onToggleCollapsed,
  onCloseMobile,
}: SidebarProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  // Clip the rail while its width animates so expanded content is revealed
  // left-to-right instead of reflowing; overflow is restored once collapsed and
  // settled, so the "Open sidebar" tooltip can overflow to the right.
  const [animatingCollapse, setAnimatingCollapse] = useState(false)
  // Start clipping the moment a collapse/expand is initiated (not in an effect —
  // that trips react-hooks/set-state-in-effect); onTransitionEnd clears it.
  const handleToggleCollapsed = () => {
    setAnimatingCollapse(true)
    onToggleCollapsed()
  }

  // Clip during the width animation; keep overflow visible only once a collapsed
  // rail has settled (so its hover tooltip can escape to the right).
  const clip = animatingCollapse || !collapsed

  // Fallback clear: if the width transitionend never fires (e.g. transitions
  // disabled globally), drop the flag anyway so overflow can't latch hidden.
  useEffect(() => {
    if (!animatingCollapse) return
    const id = setTimeout(() => setAnimatingCollapse(false), 400)
    return () => clearTimeout(id)
  }, [animatingCollapse])

  // Escape closes the mobile drawer (parity with the X button and scrim).
  useEffect(() => {
    if (!mobileOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseMobile()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [mobileOpen, onCloseMobile])

  // Mobile drawer focus: on open, store the trigger and focus the close button
  // (AppShell marks <main> inert to trap focus); on close, restore the trigger.
  // Desktop never enters this — `mobileOpen` is mobile-only.
  useEffect(() => {
    if (mobileOpen) {
      triggerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
      closeRef.current?.focus()
    } else if (triggerRef.current) {
      // Restore only if the trigger is still visible — after a resize past `md`
      // the mobile hamburger is display:none, and focusing it drops focus to body.
      const trigger = triggerRef.current
      triggerRef.current = null
      if (trigger.isConnected && trigger.offsetParent !== null) trigger.focus()
    }
  }, [mobileOpen])

  return (
    <>
      {/* Scrim — mobile only, behind the drawer. */}
      <div
        aria-hidden="true"
        onClick={onCloseMobile}
        className={cn(
          "fixed inset-0 z-30 bg-nightglass/70 transition-opacity duration-300 md:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <aside
        id={SIDEBAR_ID}
        data-open={mobileOpen}
        // Dialog semantics apply only while the mobile drawer is open; on
        // desktop the same element is a persistent complementary rail.
        role={mobileOpen ? "dialog" : undefined}
        aria-modal={mobileOpen ? true : undefined}
        aria-label={mobileOpen ? "Sidebar menu" : undefined}
        onTransitionEnd={(event) => {
          if (event.propertyName === "width") setAnimatingCollapse(false)
        }}
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[300px] flex-col border-r border-linen/10",
          // Tailwind v4 maps translate-x-* to the `translate` property (not
          // `transform`), so the transition must name `translate` for the
          // mobile drawer to slide; `width` covers the desktop collapse.
          "transition-[width,translate] duration-300 ease-[var(--ease-vigil)]",
          // Opaque while the mobile drawer is open so the chat doesn't show
          // through it; translucent over the vignette as a desktop rail.
          mobileOpen ? "bg-embersoot" : "bg-embersoot/40",
          clip ? "overflow-hidden" : "overflow-visible",
          // Mobile: slide off-canvas unless open.
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          // Desktop: in-flow, always visible; width follows the collapse flag.
          "md:static md:translate-x-0",
          collapsed ? "md:w-[68px]" : "md:w-[280px]",
        )}
      >
        {/* Header: brand on the left, toggle/close on the right. */}
        <div
          className={cn(
            "flex items-center gap-2 px-5 pt-6 pb-2",
            collapsed && "md:px-0",
          )}
        >
          <div
            className={cn(
              "group/brand relative flex min-w-0 flex-1 items-center",
              collapsed && "md:justify-center",
            )}
          >
            {/* Brand mark + wordmark. When collapsed on desktop the wordmark
                is hidden and the mark fades on hover to reveal the expand
                toggle beneath it. */}
            <span
              className={cn(
                "flex items-center gap-2.5",
                collapsed &&
                  "md:transition-opacity md:duration-300 md:group-hover/brand:opacity-0 md:group-focus-within/brand:opacity-0",
              )}
            >
              <BrandLockup wordmark={false} />
              <span
                className={cn(
                  "whitespace-nowrap font-body text-[17px] font-medium tracking-[-0.005em] text-linen",
                  collapsed && "md:hidden",
                )}
              >
                jesusfilm.ai
              </span>
            </span>

            {/* Collapsed-only expand affordance: hidden until the brand area
                is hovered/focused (desktop), with the Gemini "Open sidebar"
                tooltip. */}
            {collapsed ? (
              <button
                type="button"
                onClick={handleToggleCollapsed}
                aria-label="Open sidebar"
                className="absolute left-1/2 hidden size-10 -translate-x-1/2 items-center justify-center rounded-full text-linen opacity-0 transition-opacity duration-300 hover:bg-linen/[0.06] focus-visible:opacity-100 group-hover/brand:opacity-100 md:flex"
              >
                <PanelIcon className="size-5" />
                {/* Visual tooltip only — aria-hidden so it doesn't duplicate
                    the button's "Open sidebar" accessible name. */}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-[calc(100%+10px)] whitespace-nowrap rounded-lg bg-linen px-2.5 py-1 text-xs font-medium text-hearthblack opacity-0 transition-opacity duration-150 group-hover/brand:opacity-100"
                >
                  Open sidebar
                </span>
              </button>
            ) : null}
          </div>

          {/* Desktop collapse toggle (expanded only). */}
          {!collapsed ? (
            <button
              type="button"
              onClick={handleToggleCollapsed}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              className="hidden size-9 shrink-0 items-center justify-center rounded-lg text-ash transition-colors duration-300 hover:bg-linen/[0.06] hover:text-linen md:inline-flex"
            >
              <PanelIcon className="size-5" />
            </button>
          ) : null}

          {/* Mobile close (X) — always present in the drawer, never on desktop. */}
          <button
            ref={closeRef}
            type="button"
            onClick={onCloseMobile}
            aria-label="Close sidebar"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-ash transition-colors duration-300 hover:bg-linen/[0.06] hover:text-linen md:hidden"
          >
            <CloseIcon className="size-5" />
          </button>
        </div>

        {/* New conversation. Icon-only and centered when collapsed on desktop. */}
        <div className={cn("px-3 pt-4", collapsed && "md:px-0")}>
          <button
            type="button"
            onClick={() => {
              onNew()
              onCloseMobile()
            }}
            title="New conversation"
            className={cn(
              "flex w-full items-center gap-2.5 rounded-[10px] border border-linen/10 px-3.5 py-2.5 text-left text-sm font-medium text-linen transition-colors duration-300 hover:border-linen/20 hover:bg-linen/[0.04]",
              collapsed &&
                "md:mx-auto md:w-10 md:justify-center md:gap-0 md:border-transparent md:p-0 md:py-2.5 md:hover:border-transparent",
            )}
          >
            <ComposeIcon className="size-[18px] shrink-0 text-vesper" />
            <span className={cn("whitespace-nowrap", collapsed && "md:hidden")}>
              New conversation
            </span>
          </button>
        </div>

        {/* Conversation history — hidden when collapsed on desktop. */}
        <nav
          aria-label="Conversations"
          className={cn(
            "mt-4 flex-1 overflow-y-auto px-3 pb-5",
            collapsed && "md:hidden",
          )}
        >
          <ul className="flex flex-col gap-0.5">
            {conversations.map((conversation) => {
              const active = conversation.id === activeId
              const replying = pendingIds.has(conversation.id)
              return (
                <li key={conversation.id}>
                  <button
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => {
                      onSelect(conversation.id)
                      onCloseMobile()
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-3.5 py-2.5 text-left text-sm transition-colors duration-300",
                      active
                        ? "bg-linen/[0.06] text-linen"
                        : "text-ash hover:bg-linen/[0.03] hover:text-linen",
                    )}
                    title={conversation.title}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {conversation.title}
                    </span>
                    {replying ? (
                      <>
                        <span
                          aria-hidden="true"
                          data-replying="true"
                          className="size-1.5 shrink-0 rounded-full bg-lamplight [animation:vigil-pulse_2s_var(--ease-vigil)_infinite]"
                        />
                        <span className="sr-only">Replying</span>
                      </>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>
      </aside>
    </>
  )
}
