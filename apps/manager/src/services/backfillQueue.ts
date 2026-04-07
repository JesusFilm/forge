// Backfill queue client — fetches the Phase 1 video queue and processed IDs from CMS.

import { cmsGet } from "@/services/cmsClient"

export type BackfillVideo = {
  videoId: number
  coreId: string | null
  title: string | null
  label: string | null
  muxAssetId: string
  playbackId: string
  subtitleUrl: string
  subtitleLanguage: string
}

export async function fetchBackfillQueue(): Promise<BackfillVideo[]> {
  const data = await cmsGet<{ videos: BackfillVideo[]; total: number }>(
    "/backfill-queue",
  )
  return data.videos
}

export async function fetchProcessedKeys(): Promise<Set<string>> {
  const data = await cmsGet<{
    entries: Array<{ videoId: number; language: string }>
  }>("/scene-embedding/processed-video-ids")
  return new Set(data.entries.map((e) => `${e.videoId}:${e.language}`))
}
