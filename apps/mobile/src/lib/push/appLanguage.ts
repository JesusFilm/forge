/**
 * The app language a registration carries (R2, R13's first rung): the dub
 * language slug the viewer picked, persisted with the watch preferences.
 *
 * Two sources, in this order, and the order is the point. The provider PUBLISHES
 * the live preference as soon as the preferences have hydrated, so a language
 * pick is readable at once; before that, the persisted blob is read directly,
 * so the first registration of a cold launch still carries the real slug rather
 * than waiting for React.
 *
 * Publishing is what closes a race: the preferences provider writes storage
 * without awaiting it, so a payload built from storage alone could read the
 * PREVIOUS slug and then never register the new one until the weekly refresh.
 */

import AsyncStorage from "@react-native-async-storage/async-storage"

import {
  WATCH_PREFERENCES_STORAGE_KEY,
  parseStoredPreferences,
} from "../watchPreferences"

let publishedSlug: string | null = null
let published = false

export function publishPushAppLanguageSlug(slug: string | null): void {
  published = true
  publishedSlug = slug
}

export async function readPushAppLanguageSlug(): Promise<string | null> {
  if (published) return publishedSlug
  try {
    const raw = await AsyncStorage.getItem(WATCH_PREFERENCES_STORAGE_KEY)
    return parseStoredPreferences(raw).audioLanguageSlug
  } catch {
    // A failed read sends the default slug, which is one English registration
    // rather than none.
    return null
  }
}

/** Test seam: module state outlives a test file. */
export function resetPushAppLanguageForTests(): void {
  published = false
  publishedSlug = null
}
