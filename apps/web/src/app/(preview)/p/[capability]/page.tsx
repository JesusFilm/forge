import type { Metadata } from "next"
import { headers } from "next/headers"
import { notFound } from "next/navigation"
import { NextIntlClientProvider } from "next-intl"
import { setRequestLocale } from "next-intl/server"

import { PublicUserPlaylistPage } from "@/components/user-playlists/PublicUserPlaylistPage"
import {
  loadClientMessages,
  PUBLIC_USER_PLAYLIST_CLIENT_MESSAGE_NAMESPACES,
} from "@/i18n/client-messages"
import { loadPublicUserPlaylist } from "@/lib/user-playlist"
import {
  openPublicUserPlaylistCapability,
  PUBLIC_USER_PLAYLIST_CAPABILITY_HEADER,
} from "@/lib/user-playlist-public-boundary"

export const dynamic = "force-dynamic"
export const revalidate = 0
export const fetchCache = "force-no-store"

export const metadata: Metadata = {
  title: "Community playlist",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noarchive: true,
      noimageindex: true,
    },
  },
  referrer: "no-referrer",
}

class PublicUserPlaylistRenderDependencyError extends Error {
  constructor() {
    super("Public playlist dependency became unavailable after preflight")
    this.name = "PublicUserPlaylistRenderDependencyError"
  }
}

export default async function PublicPlaylistRoute() {
  const requestHeaders = await headers()
  const capability = openPublicUserPlaylistCapability(
    requestHeaders.get(PUBLIC_USER_PLAYLIST_CAPABILITY_HEADER),
    {
      secret: process.env.USER_PLAYLIST_TRUSTED_CONTEXT_HMAC_SECRET ?? "",
      now: new Date(),
    },
  )
  if (!capability) notFound()
  const result = await loadPublicUserPlaylist({
    capability,
    requestHeaders,
  })
  if (result.kind === "unavailable") notFound()
  if (result.kind === "service-unavailable") {
    throw new PublicUserPlaylistRenderDependencyError()
  }

  setRequestLocale(result.data.uiLocale)
  const messages = await loadClientMessages(
    result.data.uiLocale,
    PUBLIC_USER_PLAYLIST_CLIENT_MESSAGE_NAMESPACES,
  )

  return (
    <NextIntlClientProvider locale={result.data.uiLocale} messages={messages}>
      <PublicUserPlaylistPage
        data={result.data}
        // Admin intents last at most ten minutes and currently default to five.
        // The UI expires conservatively so a stale dialog can offer a reload
        // instead of repeatedly submitting a locally known-old intent.
        intentTtlMs={4 * 60 * 1_000}
      />
    </NextIntlClientProvider>
  )
}
