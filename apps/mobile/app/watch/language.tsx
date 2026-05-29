import { useCallback } from "react"
import { useRouter } from "expo-router"

import { LanguageSheetContent } from "../../src/components/watch/LanguageSheet"
import { useWatchSession } from "../../src/contexts/WatchSessionProvider"

export default function LanguageSheetRoute() {
  const router = useRouter()
  const { video, activeVariant, setActiveVariantIndex } = useWatchSession()

  const handleLanguageChange = useCallback(
    (variantSlug: string) => {
      if (!video) return
      const idx = video.variants.findIndex((v) => v.slug === variantSlug)
      if (idx >= 0) setActiveVariantIndex(idx)
    },
    [video, setActiveVariantIndex],
  )

  if (!video) return null

  return (
    <LanguageSheetContent
      variants={video.variants}
      activeVariantSlug={activeVariant?.slug ?? ""}
      onLanguageChange={handleLanguageChange}
      onClose={() => router.back()}
    />
  )
}
