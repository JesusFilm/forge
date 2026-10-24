import { useCallback } from "react"
import { useRouter } from "expo-router"

import { LanguageSheetContent } from "../../src/components/watch/LanguageSheet"
import { SheetLoading } from "../../src/components/watch/SheetLoading"
import { useDownloads } from "../../src/contexts/DownloadsProvider"
import { useWatchSession } from "../../src/contexts/WatchSessionProvider"

export default function LanguageSheetRoute() {
  const router = useRouter()
  const { video, activeVariant, setActiveVariantIndex } = useWatchSession()
  const { isReady: downloadsReady, committedCopyFor } = useDownloads()

  const handleLanguageChange = useCallback(
    (variantSlug: string) => {
      if (!video) return
      const idx = video.variants.findIndex((v) => v.slug === variantSlug)
      if (idx >= 0) setActiveVariantIndex(idx)
    },
    [video, setActiveVariantIndex],
  )

  if (!video) return null
  if (video.variants.length === 0) return <SheetLoading />

  // The file on disk names its own dub (mid-swap that is the OLD copy), so the
  // sheet marks the language that plays offline, not the one downloading.
  const downloadedDubDocumentId = downloadsReady
    ? (committedCopyFor(video.slug)?.dubDocumentId ?? null)
    : null

  return (
    <LanguageSheetContent
      variants={video.variants}
      activeVariantSlug={activeVariant?.slug ?? ""}
      downloadedDubDocumentId={downloadedDubDocumentId}
      onLanguageChange={handleLanguageChange}
      onClose={() => router.back()}
    />
  )
}
