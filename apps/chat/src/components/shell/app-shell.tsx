"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { type ChatIdentity } from "@/auth/session-cookie"
import { SIGN_IN_ERROR_PARAM } from "@/auth/sign-in-notice"
import { BrandLockup } from "@/components/brand/brand-lockup"
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
 *
 * Auth props (feat-207) are also read server-side in page.tsx and threaded to
 * the sidebar's account control: `authConfigured` (KTD6 gate), `identity` (the
 * signed-in claims, or null), and `signInError` (the R12 marker). Auth changes
 * identity only — nothing here is gated on it (R3/R7).
 */
export function AppShell({
  seekerEnabled = false,
  authConfigured = false,
  identity = null,
  signInError = false,
}: {
  seekerEnabled?: boolean
  authConfigured?: boolean
  identity?: ChatIdentity | null
  signInError?: boolean
}) {
  const {
    conversations,
    activeId,
    activeConversation,
    draft,
    pending,
    pendingIds,
    streamingMessageId,
    history,
    setDraft,
    send,
    stopReply,
    newConversation,
    selectConversation,
    retryHistory,
    loadMoreHistory,
    retryReplay,
  } = useConversations(seekerEnabled)

  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  // Stable so Sidebar's Escape-listener effect doesn't re-register on every
  // AppShell render (e.g. when a reply arrives) while the drawer is open.
  const closeMobile = useCallback(() => setMobileOpen(false), [])

  // feat-270: the New action lands on a ready-to-type pane, including the
  // no-op case where the active conversation is already the fresh empty one.
  // From the drawer, focus is deferred (flag below) — <main> is still inert.
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const pendingComposerFocusRef = useRef(false)
  const newConversationFocused = () => {
    newConversation()
    if (mobileOpen) pendingComposerFocusRef.current = true
    else composerRef.current?.focus()
  }

  // Fires once the drawer close commits (inert lifted). Runs after the
  // sidebar chrome's trigger-restore (child effects first), so the composer
  // keeps the final focus.
  useEffect(() => {
    if (mobileOpen || !pendingComposerFocusRef.current) return
    pendingComposerFocusRef.current = false
    composerRef.current?.focus()
  }, [mobileOpen])

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

  // Strip the R12 sign-in-error marker from the URL after first read (KTD7), so
  // a refresh/share/bookmark doesn't re-show the notice indefinitely. The prop
  // stays true for this render (the notice shows once); only the URL is cleaned.
  useEffect(() => {
    if (!signInError) return
    const url = new URL(window.location.href)
    if (url.searchParams.has(SIGN_IN_ERROR_PARAM)) {
      url.searchParams.delete(SIGN_IN_ERROR_PARAM)
      window.history.replaceState(null, "", url.toString())
    }
  }, [signInError])

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
        authConfigured={authConfigured}
        identity={identity}
        signInError={signInError}
        history={history}
        onNew={newConversationFocused}
        onSelect={selectConversation}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
        onCloseMobile={closeMobile}
        onRetryHistory={retryHistory}
        onLoadMore={loadMoreHistory}
      />
      {/* `inert` while the drawer is open traps focus inside it and blocks
          interaction with the content behind the scrim (mobile only — the
          drawer can't open on desktop). */}
      <main
        inert={mobileOpen}
        className="relative flex min-w-0 flex-1 flex-col"
      >
        {/* Mobile-only top bar (feat-270): the rail is off-canvas below md,
            so the drawer trigger gets a real in-flow surface — never floating
            over transcript text — with the brand as its anchor. */}
        <header className="flex shrink-0 items-center gap-2 border-b border-linen/10 bg-hearthblack px-2 py-1.5 md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            aria-controls={SIDEBAR_ID}
            aria-expanded={mobileOpen}
            className="inline-flex size-10 items-center justify-center rounded-full text-linen transition-colors duration-300 hover:bg-linen/[0.06]"
          >
            <MenuIcon className="size-5" />
          </button>
          <BrandLockup />
        </header>
        <Chat
          conversation={activeConversation}
          draft={draft}
          pending={pending}
          streamingMessageId={streamingMessageId}
          seekerEnabled={seekerEnabled}
          replayState={
            activeConversation.origin === "server"
              ? (activeConversation.replay ?? null)
              : null
          }
          composerTextareaRef={composerRef}
          onDraftChange={setDraft}
          onSend={send}
          onStop={stopReply}
          onRetryReplay={retryReplay}
          onStartNew={newConversationFocused}
        />
      </main>
    </div>
  )
}
