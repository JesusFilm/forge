import "server-only"

import { unstable_cache } from "next/cache"

import type { WatchSubtitle } from "@/lib/content"
import {
  filterTranscriptSubtitlesForAudio,
  formatCompactTranscript,
  parseVtt,
  pickInitialSubtitleSlug,
  type InitialSubtitleTranscript,
} from "@/lib/subtitle-transcript"
import { WATCH_CACHE_TAGS } from "@/lib/watch-cache-tags"
import { logWatchServerEvent } from "@/lib/watch-observability"

const WATCH_TRANSCRIPT_REVALIDATE_SECONDS = 60 * 60
const WATCH_TRANSCRIPT_FETCH_TIMEOUT_MS = 5_000

const fetchCompactTranscript = unstable_cache(
  async (vttSrc: string): Promise<string> => {
    const response = await fetch(vttSrc, {
      cache: "force-cache",
      signal: AbortSignal.timeout(WATCH_TRANSCRIPT_FETCH_TIMEOUT_MS),
      next: {
        revalidate: WATCH_TRANSCRIPT_REVALIDATE_SECONDS,
        tags: [WATCH_CACHE_TAGS.video],
      },
    })
    if (!response.ok) {
      throw new Error(`Transcript fetch failed: HTTP ${response.status}`)
    }
    return formatCompactTranscript(parseVtt(await response.text()))
  },
  ["watch-transcript-compact-vtt"],
  {
    revalidate: WATCH_TRANSCRIPT_REVALIDATE_SECONDS,
    tags: [WATCH_CACHE_TAGS.video],
  },
)

export async function getInitialSubtitleTranscript({
  subtitles,
  audioSlug,
}: {
  subtitles: WatchSubtitle[]
  audioSlug: string | null | undefined
}): Promise<InitialSubtitleTranscript> {
  const transcriptSubtitles = filterTranscriptSubtitlesForAudio(
    subtitles,
    audioSlug,
  )
  const selectedSlug = pickInitialSubtitleSlug(transcriptSubtitles, audioSlug)
  if (!selectedSlug) return null

  const selectedSubtitle =
    transcriptSubtitles.find((s) => s.language.slug === selectedSlug) ?? null
  if (!selectedSubtitle) return null

  const startedAt = Date.now()
  try {
    return {
      vttSrc: selectedSubtitle.vttSrc,
      compactText: await fetchCompactTranscript(selectedSubtitle.vttSrc),
    }
  } catch (error) {
    logWatchServerEvent("watch_transcript.fetch.failed", {
      reason:
        error instanceof DOMException && error.name === "TimeoutError"
          ? "timeout"
          : "request_failed",
      elapsedMs: Date.now() - startedAt,
      timeoutMs: WATCH_TRANSCRIPT_FETCH_TIMEOUT_MS,
    })
    return { vttSrc: selectedSubtitle.vttSrc, compactText: null }
  }
}
