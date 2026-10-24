import { type RefObject } from "react"

import { BrandLockup } from "@/components/brand/brand-lockup"
import { cn } from "@/lib/cn"

import { type CollapsedStyles } from "./sidebar-collapsed-styles"
import { CloseIcon, PanelIcon } from "./icons"

type SidebarHeaderProps = {
  collapsed: boolean
  styles: CollapsedStyles
  closeRef: RefObject<HTMLButtonElement | null>
  onToggleCollapsed: () => void
  onCloseMobile: () => void
}

/**
 * Sidebar top row: brand mark + wordmark on the left, and the three mutually
 * exclusive controls on the right — the desktop collapse toggle (expanded
 * only), the collapsed-rail expand affordance (hidden until the brand area is
 * hovered/focused, with the "Open sidebar" tooltip), and the mobile drawer
 * close (X, never on desktop). Purely presentational; collapse/close behavior
 * is supplied by the parent via callbacks and `useSidebarChrome`.
 */
export function SidebarHeader({
  collapsed,
  styles,
  closeRef,
  onToggleCollapsed,
  onCloseMobile,
}: SidebarHeaderProps) {
  return (
    <div
      className={cn("flex items-center gap-2 px-5 pt-6 pb-2", styles.header)}
    >
      <div
        className={cn(
          "group/brand relative flex min-w-0 flex-1 items-center",
          styles.brand,
        )}
      >
        {/* Brand mark + wordmark. When collapsed on desktop the wordmark is
            hidden and the mark fades on hover to reveal the expand toggle. */}
        <span className={cn("flex items-center gap-2.5", styles.brandMark)}>
          <BrandLockup wordmark={false} />
          <span
            className={cn(
              "whitespace-nowrap font-body text-[17px] font-medium tracking-[-0.005em] text-linen",
              styles.wordmark,
            )}
          >
            jesusfilm.ai
          </span>
        </span>

        {/* Collapsed-only expand affordance: hidden until the brand area is
            hovered/focused (desktop), with the Gemini "Open sidebar" tooltip. */}
        {collapsed ? (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="Open sidebar"
            className="absolute left-1/2 hidden size-10 -translate-x-1/2 items-center justify-center rounded-full text-linen opacity-0 transition-opacity duration-300 hover:bg-linen/[0.06] focus-visible:opacity-100 group-hover/brand:opacity-100 md:flex"
          >
            <PanelIcon className="size-5" />
            {/* Visual tooltip only — aria-hidden so it doesn't duplicate the
                button's "Open sidebar" accessible name. */}
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
          onClick={onToggleCollapsed}
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
  )
}
