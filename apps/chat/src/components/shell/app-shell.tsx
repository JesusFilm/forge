"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { type ChatIdentity } from "@/auth/session-cookie"
import { SIGN_IN_ERROR_PARAM } from "@/auth/sign-in-notice"
import { BrandLockup } from "@/components/brand/brand-lockup"
import { Chat } from "@/components/chat/chat"
import {
  DenialScreen,
  type DeniedScreen,
} from "@/components/chat/denial-screens"
import { fallbackTitle } from "@/lib/conversations"
import { useConversationUrl } from "@/lib/use-conversation-url"
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
 * vs the local stub — inside useConversations, and gates the feat-209 URL hook.
 *
 * Auth props (feat-207) are also read server-side in page.tsx and threaded to
 * the sidebar's account control: `authConfigured` (KTD6 gate), `identity` (the
 * signed-in claims, or null), and `signInError` (the R12 marker). Auth changes
 * identity only — nothing here is gated on it (R3/R7).
 *
 * feat-209 deep-link inputs, resolved by the /c/[id] route: on a GRANTED shell
 * `initialConversationId` seeds the session's adopted row and mounts the URL
 * hook against it; with `deniedScreen` set the denial pane replaces <Chat>
 * (KTD5/KTD6) and the id only feeds the sign-in returnTo links (KTD8). A
 * granted deep link whose replay resolves "not_available" ESCALATES to the
 * same unavailable pane — deep-link conversation only; rail selections keep
 * chat.tsx's in-pane replay states. Popstate-driven conversation changes close
 * the drawer and announce through the polite live region below.
 */
export function AppShell({
  seekerEnabled = false,
  authConfigured = false,
  identity = null,
  signInError = false,
  initialConversationId,
  deniedScreen,
}: {
  seekerEnabled?: boolean
  authConfigured?: boolean
  identity?: ChatIdentity | null
  signInError?: boolean
  /** Deep-link conversation id (lowercased by the route). Doubles as the
   * denied id for returnTo links when `deniedScreen` is set. */
  initialConversationId?: string
  /** Server-decided denial pane (feat-209 KTD5); renders in place of Chat. */
  deniedScreen?: DeniedScreen
}) {
  // Structural KTD5 belt: a denial shell renders the gate-granted layers
  // (history hydration, URL sync) inert even if a caller ever passes
  // seekerEnabled=true alongside deniedScreen — the route never should.
  const denialShell = deniedScreen !== undefined
  const grantedShell = seekerEnabled && !denialShell
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
    adoptConversation,
    retryHistory,
    loadMoreHistory,
    retryReplay,
  } = useConversations(
    grantedShell,
    // KTD5 guard: on a denial shell the id serves ONLY the returnTo links —
    // it must never seed an adopted row or fire a stray replay fetch.
    denialShell ? undefined : initialConversationId,
  )

  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  // Stable so Sidebar's Escape-listener effect doesn't re-register on every
  // AppShell render (e.g. when a reply arrives) while the drawer is open.
  const closeMobile = useCallback(() => setMobileOpen(false), [])

  // The pre-navigation active id, armed by the popstate path only. The
  // announce effect below resolves the label AFTER React re-renders — the
  // handler fires before the new snapshot exists anywhere in the tree.
  const historyNavFromRef = useRef<string | null>(null)
  const announcementRef = useRef<HTMLDivElement | null>(null)
  const activeIdRef = useRef(activeId)
  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  // Fired synchronously inside the popstate handler: mirror the row-click
  // path (drawer close) and arm the one-shot announcement.
  const onHistoryNavigation = useCallback(() => {
    setMobileOpen(false)
    historyNavFromRef.current = activeIdRef.current
  }, [])

  useConversationUrl({
    enabled: grantedShell,
    activeId,
    serverPersisted: activeConversation.serverPersisted === true,
    adoptConversation,
    newConversation,
    onHistoryNavigation,
  })

  // Announce a popstate-driven conversation CHANGE once the new snapshot has
  // rendered (the sidebar's row-label rule). Runs every render — the armed ref
  // gates it, clicks disarm it below; the live region is written imperatively.
  useEffect(() => {
    const from = historyNavFromRef.current
    if (from === null) return
    historyNavFromRef.current = null
    if (from === activeId || announcementRef.current === null) return
    const label =
      activeConversation.title.trim().length > 0
        ? activeConversation.title
        : fallbackTitle(activeConversation.lastActivityAt ?? "")
    announcementRef.current.textContent = `Opened ${label}`
  })

  // Click-driven selection stays silent: a no-op traverse may never have
  // re-rendered to consume the armed flag, so clicks disarm it explicitly.
  const selectFromRail = useCallback(
    (id: string) => {
      historyNavFromRef.current = null
      selectConversation(id)
    },
    [selectConversation],
  )

  // feat-270: the New action lands on a ready-to-type pane, including the
  // no-op case where the active conversation is already the fresh empty one.
  // From the drawer, focus is deferred (flag below) — <main> is still inert.
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const pendingComposerFocusRef = useRef(false)
  const newConversationFocused = () => {
    historyNavFromRef.current = null
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

  // KTD8: every /c/<id> render — granted or denied — threads the deep link
  // into every sign-in affordance, the rail-foot control included.
  const signInReturnTo =
    initialConversationId !== undefined
      ? `/c/${initialConversationId}`
      : undefined

  // KTD5 escalation: only the DEEP-LINK conversation's dead replay escalates
  // to the full denial pane; rail selections keep chat.tsx's in-pane state.
  const escalatedUnavailable =
    deniedScreen === undefined &&
    initialConversationId !== undefined &&
    activeId === initialConversationId &&
    activeConversation.replay === "not_available"
  const paneDenial =
    deniedScreen ?? (escalatedUnavailable ? "unavailable" : undefined)

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
        deniedShell={deniedScreen !== undefined}
        signInReturnTo={signInReturnTo}
        onNew={newConversationFocused}
        onSelect={selectFromRail}
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
        {paneDenial !== undefined ? (
          <DenialScreen screen={paneDenial} returnTo={signInReturnTo} />
        ) : (
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
        )}
      </main>
      {/* Always-mounted polite live region: popstate-driven conversation
          changes announce here — history traversal has no click feedback.
          Written imperatively by the announce effect; React renders no child. */}
      <div
        ref={announcementRef}
        aria-live="polite"
        data-history-announcement
        className="sr-only"
      />
    </div>
  )
}
