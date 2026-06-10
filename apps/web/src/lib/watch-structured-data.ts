import type { WatchVideoMetadataModel } from "@/lib/experience-metadata"

function secondsToIsoDuration(seconds: number | null): string | undefined {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) {
    return undefined
  }
  return `PT${Math.round(seconds)}S`
}

export function watchVideoStructuredDataJson(
  model: WatchVideoMetadataModel,
): string {
  const payload = {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: model.videoTitle,
    ...(model.description && { description: model.description }),
    url: model.canonicalUrl,
    thumbnailUrl: [model.image.url],
    ...(model.inLanguage && { inLanguage: model.inLanguage }),
    ...(secondsToIsoDuration(model.durationSeconds) && {
      duration: secondsToIsoDuration(model.durationSeconds),
    }),
  }

  return JSON.stringify(payload).replace(/</g, "\\u003c")
}
