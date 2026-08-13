"use server"

import type { Route } from "next"

import { resolveWatchLanguagePickerVariants } from "./content"
import { deriveLanguageDisplay } from "./language-display"
import { tryAsContentSlug, tryAsLocaleSlug, watchVideoPath } from "./routes"
import {
  getWatchRouteManifest,
  proveWatchContentAudioLanguageByManifest,
} from "./watch-route-manifest"

export type WatchUnavailableRecoveryAudioOption = {
  slug: string
  name: string
  nativeName: string | null
  bcp47: string | null
  href: Route
}

export type WatchUnavailableRecoveryResolution = {
  verifiedGap: boolean
  targetImageUrl: string | null
  audioOptions: WatchUnavailableRecoveryAudioOption[]
}

export type ResolveWatchUnavailableRecoveryInput = {
  contentSlug: string
  requestedLanguageSlug: string
  targetImageUrl?: string | null
}

function approvedArtworkUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null
  try {
    const url = new URL(value)
    if (url.protocol !== "https:") return null
    return [
      "imagedelivery.net",
      "image.mux.com",
      "admin.jesusfilm.org",
    ].includes(url.hostname)
      ? url.toString()
      : null
  } catch {
    return null
  }
}

const EMPTY_RESOLUTION: WatchUnavailableRecoveryResolution = {
  verifiedGap: false,
  targetImageUrl: null,
  audioOptions: [],
}

export async function resolveWatchUnavailableRecovery(
  input: ResolveWatchUnavailableRecoveryInput,
): Promise<WatchUnavailableRecoveryResolution> {
  const contentSlug = tryAsContentSlug(input.contentSlug)
  const requestedLanguageSlug = tryAsLocaleSlug(input.requestedLanguageSlug)
  const manifest = await getWatchRouteManifest()
  if (!contentSlug || !requestedLanguageSlug || !manifest) {
    return EMPTY_RESOLUTION
  }
  if (
    proveWatchContentAudioLanguageByManifest(
      manifest,
      contentSlug,
      requestedLanguageSlug,
    ).kind !== "known-missing"
  ) {
    return EMPTY_RESOLUTION
  }

  const variants = await resolveWatchLanguagePickerVariants(contentSlug)
  const audioOptions: WatchUnavailableRecoveryAudioOption[] = []

  for (const variant of variants) {
    const languageSlug = variant.language?.slug
      ? tryAsLocaleSlug(variant.language.slug)
      : null
    if (
      !languageSlug ||
      languageSlug === requestedLanguageSlug ||
      proveWatchContentAudioLanguageByManifest(
        manifest,
        contentSlug,
        languageSlug,
      ).kind !== "admitted"
    ) {
      continue
    }

    const display = deriveLanguageDisplay(languageSlug, variant.language?.name)
    const nativeName =
      display.nativeName ?? variant.language?.nativeName?.trim() ?? null
    audioOptions.push({
      slug: languageSlug,
      name: display.name,
      nativeName: nativeName && nativeName !== display.name ? nativeName : null,
      bcp47: variant.language?.bcp47?.trim() || null,
      href: watchVideoPath(contentSlug, languageSlug),
    })
  }

  audioOptions.sort((a, b) => a.name.localeCompare(b.name))

  return {
    verifiedGap: true,
    targetImageUrl: approvedArtworkUrl(input.targetImageUrl),
    audioOptions,
  }
}
