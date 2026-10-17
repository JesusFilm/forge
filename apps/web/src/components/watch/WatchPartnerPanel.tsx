"use client"

import dynamic from "next/dynamic"
import { useEffect } from "react"
import { WatchPartnerAccount } from "./WatchPartnerAccount"
import { WatchPartnerResources } from "./WatchPartnerResources"

const WatchPartnerDownloadTools = dynamic(
  () =>
    import("./WatchPartnerDownloadTools").then(
      (module) => module.WatchPartnerDownloadTools,
    ),
  { loading: () => <p role="status">Loading download tools…</p> },
)

export function WatchPartnerPanel({
  languageSlug,
  locale,
}: {
  languageSlug: string
  locale: string
}) {
  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.has("partnerPanel")) {
      url.searchParams.delete("partnerPanel")
      window.history.replaceState(window.history.state, "", url)
    }
  }, [])
  return (
    <div className="mt-8 min-w-0 space-y-10" data-testid="watch-partner-panel">
      <WatchPartnerResources />
      <WatchPartnerAccount>
        {({ user }) => (
          <WatchPartnerDownloadTools
            key={user?.id ?? "signed-in"}
            languageSlug={languageSlug}
            locale={locale}
            accountId={user?.id}
          />
        )}
      </WatchPartnerAccount>
    </div>
  )
}
