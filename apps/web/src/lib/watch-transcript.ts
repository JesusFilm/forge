import "server-only"

import { unstable_cache } from "next/cache"

import type { WatchSubtitle } from "@/lib/content"
import {
  filterTranscriptSubtitlesForAudio,
  normalizeCueOffset,
  parseVtt,
  pickInitialSubtitleSlug,
  type InitialSubtitleTranscript,
  type SubtitleCue,
} from "@/lib/subtitle-transcript"
import { WATCH_CACHE_TAGS } from "@/lib/watch-cache-tags"

const WATCH_TRANSCRIPT_REVALIDATE_SECONDS = 60 * 60

const fetchParsedTranscriptCues = unstable_cache(
  async (
    vttSrc: string,
    durationSeconds: number | null | undefined,
  ): Promise<SubtitleCue[]> => {
    const response = await fetch(vttSrc, {
      cache: "force-cache",
      next: {
        revalidate: WATCH_TRANSCRIPT_REVALIDATE_SECONDS,
        tags: [WATCH_CACHE_TAGS.video],
      },
    })
    if (!response.ok) {
      throw new Error(`Transcript fetch failed: HTTP ${response.status}`)
    }
    const text = await response.text()
    return normalizeCueOffset(parseVtt(text), durationSeconds)
  },
  ["watch-transcript-vtt"],
  {
    revalidate: WATCH_TRANSCRIPT_REVALIDATE_SECONDS,
    tags: [WATCH_CACHE_TAGS.video],
  },
)

export async function getInitialSubtitleTranscript({
  subtitles,
  audioSlug,
  durationSeconds,
}: {
  subtitles: WatchSubtitle[]
  audioSlug: string | null | undefined
  durationSeconds: number | null | undefined
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

  try {
    return {
      vttSrc: selectedSubtitle.vttSrc,
      cues: await fetchParsedTranscriptCues(
        selectedSubtitle.vttSrc,
        durationSeconds,
      ),
    }
  } catch {
    return { vttSrc: selectedSubtitle.vttSrc, cues: null }
  }
}
