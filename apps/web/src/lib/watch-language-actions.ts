"use server"

import {
  resolveWatchLanguagePickerVariants,
  type WatchLanguagePickerVariant,
} from "@/lib/content"
import { getSearchLanguageCatalogOptions } from "@/lib/search-language-actions"
import {
  projectGlobalLanguageOptions,
  type GlobalLanguageOption,
} from "@/lib/watch-language-switcher"

export async function loadWatchLanguageOptions(input: {
  videoSlug: string
}): Promise<WatchLanguagePickerVariant[]> {
  const videoSlug = input.videoSlug.trim()
  if (!videoSlug) return []
  return resolveWatchLanguagePickerVariants(videoSlug)
}

/**
 * Keep the full Admin-backed search metadata graph on the server and return
 * only the compact public routing identity required by the global picker.
 */
export async function loadGlobalWatchLanguageOptions(): Promise<
  GlobalLanguageOption[]
> {
  const options = await getSearchLanguageCatalogOptions()
  return projectGlobalLanguageOptions(options)
}
