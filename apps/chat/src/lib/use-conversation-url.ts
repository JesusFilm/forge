"use client"

import { useEffect, useRef } from "react"

import { isConversationId, toConversationId } from "./conversation-id"

type UseConversationUrlOptions = {
  /** The gate grant. False renders the hook fully inert (R3): no history
   * writes and no listeners — anonymous/denied users keep today's URL. */
  enabled: boolean
  /** The active conversation's id, from the session snapshot. */
  activeId: string
  /** The ACTIVE conversation's serverPersisted stamp (feat-241 KTD10). */
  serverPersisted: boolean
  /** Session adopt-by-id (feat-209 U2); false = refused (denied phase). */
  adoptConversation: (id: string) => boolean
  /** Session fresh-conversation action. */
  newConversation: () => void
  /** Fired on every popstate-driven change so the shell can close the
   * mobile drawer and announce; never fired for prop-driven syncs. */
  onHistoryNavigation: () => void
}

// The deep-link prefix. Anything after it must be a UUID (lowercased by
// toConversationId) to count — "/c/<garbage>" and nested paths yield null.
function conversationIdFromPath(pathname: string): string | null {
  if (!pathname.startsWith("/c/")) return null
  return toConversationId(pathname.slice("/c/".length))
}

// Rebuild the target from the LIVE URL, mutating only pathname, so
// ?signin=failed stripping and any future query/hash params survive (KTD2).
function urlWithPathname(pathname: string): string {
  const url = new URL(window.location.href)
  url.pathname = pathname
  return url.toString()
}

/**
 * The one client hook owning both URL directions for feat-209 (KTD1/KTD2):
 * snapshot → shallow history writes, and popstate → session actions. The
 * write side derives `desiredPath` from the active conversation (persisted →
 * `/c/<id>`, else `/`) and writes only on difference: push when the active
 * id changed since the last OBSERVED snapshot, replace otherwise (mint via
 * replace keeps Back leaving the app, AE2). The read side adopts a valid
 * `/c/<id>` (lowercased), normalizes a refused adopt to `/` via replace, and
 * starts fresh for anything else — the handler never pushes. A `pageshow`
 * with `persisted` hard-reloads (R9's bfcache guard: a restored pre-sign-out
 * document would replay the previous identity's transcript). Writes pass a
 * `null` state argument on the raw history API — under Next 16 the patched
 * pushState/replaceState updates the canonical URL with no RSC fetch or
 * remount (KTD1); the session store, never the router, is the source of the
 * active id, so this hook imports no next/navigation hooks.
 */
export function useConversationUrl({
  enabled,
  activeId,
  serverPersisted,
  adoptConversation,
  newConversation,
  onHistoryNavigation,
}: UseConversationUrlOptions): void {
  // The last snapshot this hook OBSERVED — never the last write — KTD2's
  // push-vs-replace discriminator. A no-write popstate to "/" must not turn
  // the next stamp flip into a push (the Back-leaves-the-app promise).
  const lastSyncedIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    // KTD9 (scoped): this path puts the thread id in the address bar, browser
    // history, and — via the deep-link GET / RSC traverses — Cloudflare and
    // Railway HTTP access logs. App logs and proxy bodies still never carry it.
    // Fail-closed symmetry with the read side's UUID gate: a non-UUID active
    // id must never be emitted into the address bar — it derives "/".
    const desiredPath =
      serverPersisted && isConversationId(activeId) ? `/c/${activeId}` : "/"
    const idChanged =
      lastSyncedIdRef.current !== null && lastSyncedIdRef.current !== activeId
    // Re-derived on EVERY run, no-write runs included; setup re-arms it and
    // cleanup never mutates it (the StrictMode remount-safety contract).
    lastSyncedIdRef.current = activeId
    if (window.location.pathname === desiredPath) return
    const url = urlWithPathname(desiredPath)
    if (idChanged) {
      window.history.pushState(null, "", url)
    } else {
      window.history.replaceState(null, "", url)
    }
  }, [enabled, activeId, serverPersisted])

  // Re-registered on callback identity change: remove-only cleanup + re-add
  // in setup survives the StrictMode cycle with exactly one live listener.
  useEffect(() => {
    if (!enabled) return
    const onPopState = () => {
      const id = conversationIdFromPath(window.location.pathname)
      if (id === null) {
        // "/" and anything unrecognized traverse to a fresh conversation.
        newConversation()
      } else if (!adoptConversation(id)) {
        // Refused adopt: normalize the dead entry in place — never push.
        window.history.replaceState(null, "", urlWithPathname("/"))
        newConversation()
      }
      onHistoryNavigation()
    }
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [enabled, adoptConversation, newConversation, onHistoryNavigation])

  useEffect(() => {
    if (!enabled) return
    // R9 bfcache guard: force a fresh server resolution on a back/forward-
    // cache restore. Chrome's no-store eviction masks the hazard; Safari and
    // Firefox do not, so the reload is the cross-engine mechanism.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload()
    }
    window.addEventListener("pageshow", onPageShow)
    return () => window.removeEventListener("pageshow", onPageShow)
  }, [enabled])
}
