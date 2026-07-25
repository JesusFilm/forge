"use client"

import { useMemo } from "react"

import { type ChatIdentity } from "@/auth/session-cookie"
import { cn } from "@/lib/cn"
import { type Conversation } from "@/lib/conversations"

import { SidebarAccount } from "./sidebar-account"
import { collapsedStyles } from "./sidebar-collapsed-styles"
import { ConversationList } from "./sidebar-conversation-list"
import { SidebarHeader } from "./sidebar-header"
import { NewConversationButton } from "./sidebar-new-conversation"
import { listConversations, type HistoryListUi } from "./sidebar-projection"
import { useSidebarChrome } from "./use-sidebar-chrome"

type SidebarProps = {
  conversations: Conversation[]
  activeId: string
  pendingIds: ReadonlySet<string>
  collapsed: boolean
  mobileOpen: boolean
  authConfigured: boolean
  identity: ChatIdentity | null
  signInError: boolean
  history: HistoryListUi
  onNew: () => void
  onSelect: (id: string) => void
  onToggleCollapsed: () => void
  onCloseMobile: () => void
  onRetryHistory: () => void
  onLoadMore: () => void
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
 * tokens, not copied from the (single-surface) Vigil system. Local UI mechanics
 * (clip animation, Escape-to-close, drawer focus trap) live in
 * `useSidebarChrome`; the collapsed-style policy lives in `collapsedStyles`.
 */
export function Sidebar({
  conversations,
  activeId,
  pendingIds,
  collapsed,
  mobileOpen,
  authConfigured,
  identity,
  signInError,
  history,
  onNew,
  onSelect,
  onToggleCollapsed,
  onCloseMobile,
  onRetryHistory,
  onLoadMore,
}: SidebarProps) {
  const { clip, closeRef, handleToggleCollapsed, handleTransitionEnd } =
    useSidebarChrome({
      collapsed,
      mobileOpen,
      onToggleCollapsed,
      onCloseMobile,
    })

  const styles = collapsedStyles(collapsed)

  // Visible-row policy applied here (feat-281, Ruling 4b): the session hands
  // the full list; the rail decides what it shows. Memoized so row identity
  // only changes with the inputs (matches the old snapshot-cached semantics).
  const visibleConversations = useMemo(
    () => listConversations(conversations, activeId),
    [conversations, activeId],
  )

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
        onTransitionEnd={handleTransitionEnd}
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
        <SidebarHeader
          collapsed={collapsed}
          styles={styles}
          closeRef={closeRef}
          onToggleCollapsed={handleToggleCollapsed}
          onCloseMobile={onCloseMobile}
        />
        <NewConversationButton
          styles={styles}
          onNew={onNew}
          onCloseMobile={onCloseMobile}
        />
        <ConversationList
          conversations={visibleConversations}
          activeId={activeId}
          pendingIds={pendingIds}
          styles={styles}
          history={history}
          onSelect={onSelect}
          onCloseMobile={onCloseMobile}
          onRetryHistory={onRetryHistory}
          onLoadMore={onLoadMore}
        />
        <SidebarAccount
          authConfigured={authConfigured}
          identity={identity}
          signInError={signInError}
          collapsed={collapsed}
          styles={styles}
        />
      </aside>
    </>
  )
}
