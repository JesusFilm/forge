"use server"

import {
  resolveWatchLanguagePickerVariants,
  type WatchLanguagePickerVariant,
} from "@/lib/content"

export async function loadWatchLanguageOptions(input: {
  videoSlug: string
}): Promise<WatchLanguagePickerVariant[]> {
  const videoSlug = input.videoSlug.trim()
  if (!videoSlug) return []
  return resolveWatchLanguagePickerVariants(videoSlug)
}
