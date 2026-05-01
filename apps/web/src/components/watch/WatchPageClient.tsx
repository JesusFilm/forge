"use client"

import { useCallback, useRef, useState } from "react"

import type { MuxPlayerRef } from "@forge/video-player"

import { AskYoursPanel } from "@/components/watch/AskYoursPanel"
import { DownloadModal } from "@/components/watch/DownloadModal"
import { LanguagePickerModal } from "@/components/watch/LanguagePickerModal"
import { ShareModal } from "@/components/watch/ShareModal"
import { WatchSectionRenderer } from "@/components/watch/WatchSectionRenderer"
import type { MergedWatchBlock, ResolvedWatchVideo } from "@/lib/content"

type WatchVideoRecord = ResolvedWatchVideo["video"]
type WatchVariant = ResolvedWatchVideo["selectedVariant"]

export type WatchModalState =
  | "none"
  | "download"
  | "language"
  | "share"
  | "ask-yours"

export type WatchModalCallbacks = {
  openDownload: () => void
  openLanguage: () => void
  openShare: () => void
  openAskYours: () => void
  closeModal: () => void
}

type WatchPageClientProps = {
  mergedBlocks: MergedWatchBlock[]
  variant: WatchVariant
  video: WatchVideoRecord
  /**
   * Override for the URL `[locale]` slug. The route may pass an ISO code
   * ("en") even when the picked variant's slug is "english", so navigation
   * links round-trip cleanly.
   */
  languageSlug?: string
}

export function WatchPageClient({
  mergedBlocks,
  variant,
  video,
  languageSlug,
}: WatchPageClientProps) {
  // Lifted so LanguagePickerModal can read `currentTime` for the `?t=` clamp
  // on language switches.
  const playerRef = useRef<MuxPlayerRef | null>(null)
  const handlePlayerReady = useCallback((player: MuxPlayerRef | null) => {
    playerRef.current = player
  }, [])

  const currentLanguageSlug = languageSlug ?? variant.language?.slug ?? ""

  // Drop entries missing `quality` or `url` — unrenderable / unfollowable.
  const downloadsForModal = (variant.downloads ?? [])
    .filter(
      (d): d is NonNullable<typeof d> =>
        d != null && d.quality != null && d.url != null,
    )
    .map((d) => ({
      documentId: d.documentId,
      quality: d.quality as string,
      size: d.size,
      url: d.url as string,
    }))

  const variantsForLanguagePicker = (video.variants ?? [])
    .filter((v): v is NonNullable<typeof v> => v != null)
    .map((v) => ({
      documentId: v.documentId,
      hls: v.hls,
      published: v.published,
      language: v.language
        ? {
            coreId: v.language.coreId,
            slug: v.language.slug,
            name: v.language.name,
          }
        : null,
    }))

  const [modalState, setModalState] = useState<WatchModalState>("none")

  const openDownload = useCallback(() => setModalState("download"), [])
  const openLanguage = useCallback(() => setModalState("language"), [])
  const openShare = useCallback(() => setModalState("share"), [])
  const openAskYours = useCallback(() => setModalState("ask-yours"), [])
  const closeModal = useCallback(() => setModalState("none"), [])

  const modalCallbacks: WatchModalCallbacks = {
    openDownload,
    openLanguage,
    openShare,
    openAskYours,
    closeModal,
  }

  return (
    <main
      data-testid="watch-page-client"
      data-modal-state={modalState}
      className="min-h-screen bg-stone-900 text-stone-100"
    >
      <WatchSectionRenderer
        blocks={mergedBlocks}
        modalCallbacks={modalCallbacks}
        onPlayerReady={handlePlayerReady}
      />

      <DownloadModal
        open={modalState === "download"}
        downloads={downloadsForModal}
        onClose={closeModal}
      />
      <LanguagePickerModal
        open={modalState === "language"}
        variants={variantsForLanguagePicker}
        currentLanguageSlug={currentLanguageSlug}
        videoSlug={video.slug ?? ""}
        playerRef={playerRef}
        onClose={closeModal}
      />
      <ShareModal
        open={modalState === "share"}
        videoSlug={video.slug ?? ""}
        currentLanguageSlug={currentLanguageSlug}
        onClose={closeModal}
      />
      <AskYoursPanel open={modalState === "ask-yours"} onClose={closeModal} />
    </main>
  )
}

export type WatchPageClientResolved = ResolvedWatchVideo
