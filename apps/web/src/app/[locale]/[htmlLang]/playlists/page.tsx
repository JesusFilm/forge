import type { Metadata, Route } from "next"
import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"
import { getTranslations, setRequestLocale } from "next-intl/server"

import { UserPlaylistLibrary } from "@/components/user-playlists/UserPlaylistLibrary"
import { verifyAuthSession } from "@/lib/auth-session"
import { isUserPlaylistAuthoringUxEnabled } from "@/lib/feature-flags"
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
import {
  loadMyUserPlaylistsForPage,
  loadUserPlaylistPolicyForPage,
} from "@/lib/user-playlist-loaders"
import { userPlaylistServerLoginPath } from "@/lib/user-playlist-route-paths"
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
    title: t("metadataLibraryTitle"),
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

export default async function UserPlaylistLibraryPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale: rawLocale } = await params
  const { locale } = resolveWatchLocaleIdentity(rawLocale)
  setRequestLocale(locale)

  const session = await verifyAuthSession(await headers())
  if (!session.authenticated) {
    redirect(userPlaylistServerLoginPath("/watch/playlists") as Route)
  }
  const authoringEnabled = await isUserPlaylistAuthoringUxEnabled({
    kind: "user",
    key: session.userId,
    anonymous: false,
    custom: { surface: "user-playlists" },
  }).catch(() => false)
  if (!authoringEnabled) notFound()

  const [initialResult, policyResult] = await Promise.all([
    loadMyUserPlaylistsForPage({ first: 20 }),
    loadUserPlaylistPolicyForPage(),
  ])
  if (!initialResult.ok && initialResult.code === "UNAUTHENTICATED") {
    redirect(userPlaylistServerLoginPath("/watch/playlists") as Route)
  }

  return (
    <main className="min-h-screen bg-[#050505] pt-24 text-white">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <UserPlaylistLibrary
          initialResult={initialResult}
          policy={policyResult.ok ? policyResult.data : null}
          actions={ownerActions}
        />
      </div>
    </main>
  )
}
