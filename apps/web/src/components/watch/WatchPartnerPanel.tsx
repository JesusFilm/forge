"use client"

import dynamic from "next/dynamic"
import { useEffect, type ReactNode } from "react"

import { useWatchAccountSession } from "./use-watch-account-session"
import {
  WatchPartnerPromo,
  WatchPartnerUnlockedNote,
} from "./WatchPartnerPromo"
import { WatchPartnerResources } from "./WatchPartnerResources"

const WatchPartnerDownloadTools = dynamic(
  () =>
    import("./WatchPartnerDownloadTools").then(
      (module) => module.WatchPartnerDownloadTools,
    ),
  { loading: () => <p role="status">Loading download tools…</p> },
)

/**
 * The Partner tab body, as originally composed: signed out (or not yet
 * confirmed) shows only the promo and sign-in choices; a real signed-in
 * session shows the journey, the unlocked note, the resource library and the
 * account-only download tools. Identity comes only from the server session —
 * no URL flag, stored value or event can unlock it.
 */
export function WatchPartnerPanel({
  languageSlug,
  locale,
  journey,
}: {
  languageSlug: string
  locale: string
  /** The Partner questionnaire; shown only to a signed-in account. */
  journey?: ReactNode
}) {
  const { session, retry } = useWatchAccountSession()
  // Read only once the session has answered, which happens on the client
  // alone, so server rendering never touches `window`.
  const signInFailed =
    (session.status === "signed-out" || session.status === "unavailable") &&
    new URLSearchParams(window.location.search).get("auth") === "failed"

  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.has("partnerPanel")) {
      url.searchParams.delete("partnerPanel")
      window.history.replaceState(window.history.state, "", url)
    }
  }, [])

  if (session.status !== "signed-in") {
    return (
      <div
        data-testid="watch-partner-panel"
        data-account-state={session.status}
        className="min-w-0"
      >
        <WatchPartnerPromo
          pending={session.status === "checking"}
          loginUrl={
            session.status === "signed-out" ? session.loginUrl : undefined
          }
          unavailable={session.status === "unavailable"}
          onRetry={retry}
          signInFailed={signInFailed}
        />
      </div>
    )
  }

  const user = session.user
  return (
    <div
      data-testid="watch-partner-panel"
      data-account-state={session.status}
      className="min-w-0"
    >
      {journey}
      <WatchPartnerUnlockedNote name={user?.name?.trim() || undefined} />
      <WatchPartnerResources />
      <div className="mt-12 md:mt-16">
        <WatchPartnerDownloadTools
          key={user?.id ?? "signed-in"}
          languageSlug={languageSlug}
          locale={locale}
          accountId={user?.id}
        />
      </div>
    </div>
  )
}
