"use client"

import { useCallback, useEffect, useState } from "react"

import { Chat } from "@/components/chat/chat"
import { useConversations } from "@/lib/use-conversations"

import { MenuIcon } from "./icons"
import { Sidebar, SIDEBAR_ID } from "./sidebar"

/**
 * Top-level layout: owns conversation state via useConversations and lays the
 * sidebar rail beside the chat pane. Sidebar presentation is in-memory only —
 * `collapsed` drives the desktop rail (full ↔ icon-only) and `mobileOpen`
 * drives the off-canvas drawer below `md`; the two flags are independent.
 *
 * `seekerEnabled` is the deployment-wide flag, read server-side in page.tsx and
 * passed down (feat-205, R1/R2). It selects the reply source — the Seeker proxy
 * vs the local stub — inside useConversations; nothing else here depends on it.
 */
export function AppShell({
  seekerEnabled = false,
}: {
  seekerEnabled?: boolean
}) {
  const {
    conversations,
    activeId,
    activeConversation,
    draft,
    pending,
    pendingIds,
    streamingMessageId,
    setDraft,
    send,
    newConversation,
    selectConversation,
  } = useConversations(seekerEnabled)

  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  // Stable so Sidebar's Escape-listener effect doesn't re-register on every
  // AppShell render (e.g. when a reply arrives) while the drawer is open.
  const closeMobile = useCallback(() => setMobileOpen(false), [])

  // Drop the drawer's open state when the viewport grows past `md`, so the rail
  // returns to its in-flow desktop form (no stale dialog/inert semantics).
  // Guarded for jsdom, which lacks matchMedia.
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return
    const mql = window.matchMedia("(min-width: 768px)")
    const onChange = () => {
      if (mql.matches) setMobileOpen(false)
    }
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  // Lock background scroll while the mobile drawer is open.
  useEffect(() => {
    if (!mobileOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previous
    }
  }, [mobileOpen])

  return (
    <div className="flex h-dvh">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        pendingIds={pendingIds}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onNew={newConversation}
        onSelect={selectConversation}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
        onCloseMobile={closeMobile}
      />
      {/* `inert` while the drawer is open traps focus inside it and blocks
          interaction with the content behind the scrim (mobile only — the
          drawer can't open on desktop). */}
      <main
        inert={mobileOpen}
        className="relative flex min-w-0 flex-1 flex-col"
      >
        {/* Mobile-only menu trigger: the rail is off-canvas below md, so this
            floats top-left to open the drawer. */}
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          aria-controls={SIDEBAR_ID}
          aria-expanded={mobileOpen}
          className="absolute left-3 top-4 z-20 inline-flex size-10 items-center justify-center rounded-full text-linen transition-colors duration-300 hover:bg-linen/[0.06] md:hidden"
        >
          <MenuIcon className="size-5" />
        </button>
        <Chat
          conversation={activeConversation}
          draft={draft}
          pending={pending}
          streamingMessageId={streamingMessageId}
          seekerEnabled={seekerEnabled}
          onDraftChange={setDraft}
          onSend={send}
        />
      </main>
    </div>
  )
}
