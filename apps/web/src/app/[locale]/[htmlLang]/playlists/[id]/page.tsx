import type { Metadata, Route } from "next"
import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"
import { getTranslations, setRequestLocale } from "next-intl/server"

import { UserPlaylistComposer } from "@/components/user-playlists/UserPlaylistComposer"
import { verifyAuthSession } from "@/lib/auth-session"
import {
  createUserPlaylist,
  deleteUserPlaylist,
  getMyUserPlaylist,
  getUserPlaylistPolicy,
  listMyUserPlaylists,
  reshareUserPlaylist,
  revealUserPlaylistCapability,
  rotateUserPlaylistCapability,
  unshareUserPlaylist,
  updateUserPlaylist,
} from "@/lib/user-playlist-actions"
import type { UserPlaylistOwnerActions } from "@/lib/user-playlist-contract"
import { loadMyUserPlaylistForPage } from "@/lib/user-playlist-loaders"
import { resolveWatchLocaleIdentity } from "@/lib/locale"

export const dynamic = "force-dynamic"
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "UserPlaylists" })
  return {
    title: t("metadataEditorTitle"),
    robots: { index: false, follow: false },
  }
}

const ownerActions = {
  getPolicy: getUserPlaylistPolicy,
  list: listMyUserPlaylists,
  read: getMyUserPlaylist,
  create: createUserPlaylist,
  update: updateUserPlaylist,
  delete: deleteUserPlaylist,
  unshare: unshareUserPlaylist,
  reshare: reshareUserPlaylist,
  rotate: rotateUserPlaylistCapability,
  reveal: revealUserPlaylistCapability,
} satisfies UserPlaylistOwnerActions

export default async function UserPlaylistEditorPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale: rawLocale, id } = await params
  const { locale } = resolveWatchLocaleIdentity(rawLocale)
  setRequestLocale(locale)

  const session = await verifyAuthSession(await headers())
  const returnTo = `/watch/playlists/${encodeURIComponent(id)}`
  if (!session.authenticated) {
    redirect(
      `/watch/api/auth/login?returnTo=${encodeURIComponent(returnTo)}` as Route,
    )
  }

  const result = await loadMyUserPlaylistForPage(id)
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") {
      redirect(
        `/watch/api/auth/login?returnTo=${encodeURIComponent(returnTo)}` as Route,
      )
    }
    if (result.code === "NOT_FOUND" || result.code === "INVALID_INPUT") {
      notFound()
    }
    if (result.code === "INELIGIBLE") redirect("/watch/playlists" as Route)
    throw new Error("Playlist editor is temporarily unavailable")
  }

  return (
    <main className="min-h-screen bg-[#050505] pt-24 text-white">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <UserPlaylistComposer playlist={result.data} actions={ownerActions} />
      </div>
    </main>
  )
}
