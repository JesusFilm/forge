import { inPlayerMenuVisible } from "./playerSwitch"

export function nativeAndroidSessionOwnsPlayback({
  videoId,
  sessionVideo,
  activeVariantHls,
  currentUrl,
}: {
  videoId?: string | null
  sessionVideo: { documentId: string; variants: readonly unknown[] } | null
  activeVariantHls?: string | null
  currentUrl: string
}): boolean {
  if (videoId != null) {
    return (
      sessionVideo?.documentId === videoId && sessionVideo.variants.length > 0
    )
  }
  return inPlayerMenuVisible({ sessionVideo, activeVariantHls, currentUrl })
}
