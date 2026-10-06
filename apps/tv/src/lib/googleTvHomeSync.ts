import { AppState, Platform } from "react-native"
import {
  getGoogleTvHomeModule,
  type GoogleTvHomeResult,
} from "../../modules/google-tv-home"
import { getStorage } from "./safeStorage"
import {
  fetchForYou,
  recommendationsEnabled,
  getRecommendationGeneration,
} from "./recommendations/client"
import { loadWatchPreferences } from "./watchPreferences"
import {
  loadContinueWatching,
  type ContinueWatchingEntry,
} from "./watchEvents/continueWatching"
import type { WatchHomeModel } from "./watchHome/model"
import {
  googleTvContinuation,
  googleTvDiscoveryCandidates,
  googleTvPersonalizedModel,
  selectGoogleTvDiscovery,
  type DiscoveryRotation,
} from "./googleTvHomeContent"

const CONSENT_KEY = "forge.googleTvHome.localAdultConsent.v1"
const ROTATION_KEY = "forge.googleTvHome.discoveryRotation.v1"
let latestModel: WatchHomeModel | null = null
let lastContinuation = ""
let lastAttemptAt = 0
let queue: Promise<unknown> = Promise.resolve()

const unavailable = (
  message: string,
  environment: GoogleTvHomeResult["environment"] = "production",
): GoogleTvHomeResult => ({
  status: "blocked",
  environment,
  message,
  count: 0,
})

function serialized<T>(action: () => Promise<T>): Promise<T> {
  const pending = queue.then(action, action)
  queue = pending.catch(() => undefined)
  return pending
}

export async function isGoogleTvContinuationEnabled(): Promise<boolean> {
  return (await getStorage().getItem(CONSENT_KEY)) === "adult-local-enabled"
}

async function publishContinuation(): Promise<GoogleTvHomeResult> {
  const module = getGoogleTvHomeModule()
  if (!module || !latestModel || AppState.currentState !== "active")
    return unavailable("Open Home first, then return here to update Google TV.")
  const preference = await getStorage().getItem(CONSENT_KEY)
  if (preference === "pending-removal") {
    const removed = await module.remove(true)
    if (removed.status === "removed")
      await getStorage().setItem(CONSENT_KEY, "off")
    return removed
  }
  if (preference !== "adult-local-enabled")
    return unavailable("Home sharing is off.")
  const videos = googleTvContinuation(
    await loadContinueWatching(),
    latestModel,
    Date.now(),
  )
  const fingerprint = JSON.stringify(videos)
  if (fingerprint === lastContinuation)
    return unavailable("Continue Watching is already up to date.")
  const result = videos.length
    ? await module.publish(videos, true, "Continue Watching", true)
    : await module.remove(true)
  if (result.status === "published" || result.status === "removed")
    lastContinuation = fingerprint
  return result
}

export async function syncGoogleTvHome(
  model: WatchHomeModel,
  _entries?: readonly ContinueWatchingEntry[],
): Promise<void> {
  if (Platform.OS !== "android" || !Platform.isTV) return
  latestModel = model
  try {
    if (Date.now() - lastAttemptAt < 30000) return
    lastAttemptAt = Date.now()
    await serialized(publishContinuation)
  } catch {
    // OS recommendations must never block in-app Home or playback.
  }
}

export function setGoogleTvContinuationEnabled(
  enabled: boolean,
): Promise<GoogleTvHomeResult> {
  return serialized(async () => {
    await getStorage().setItem(
      CONSENT_KEY,
      enabled ? "adult-local-enabled" : "pending-removal",
    )
    lastContinuation = ""
    if (enabled) return publishContinuation()
    const module = getGoogleTvHomeModule()
    if (!module)
      return unavailable(
        "Sharing is off; install the Android native build to remove existing Home content.",
      )
    const result = await module.remove(true)
    if (result.status === "removed")
      await getStorage().setItem(CONSENT_KEY, "off")
    return result
  })
}

export function publishGoogleTvDiscoveryPreview(): Promise<GoogleTvHomeResult> {
  return serialized(async () => {
    const module = getGoogleTvHomeModule()
    if (!module || !latestModel)
      return unavailable("Open Home first to load real catalogue content.")
    const status = await module.getStatus(false)
    if (status.environment !== "verification")
      return unavailable(
        "Discovery needs an approved account identity and Google onboarding. It is disabled in production.",
      )
    if (status.status !== "available") return status
    if (!recommendationsEnabled())
      return unavailable(
        "Personalized recommendations are not enabled in this build.",
        status.environment,
      )
    let personalized: WatchHomeModel
    const generation = getRecommendationGeneration()
    try {
      const preferences = await loadWatchPreferences()
      const delivery = await fetchForYou(
        preferences.audioLanguageSlug ?? "english",
      )
      personalized = googleTvPersonalizedModel(delivery.items, latestModel)
    } catch {
      return unavailable(
        "Recommendations could not be loaded. No editorial content was substituted or published.",
        status.environment,
      )
    }
    let previous: DiscoveryRotation | null = null
    try {
      const raw: unknown = JSON.parse(
        (await getStorage().getItem(ROTATION_KEY)) ?? "null",
      )
      if (
        raw &&
        typeof raw === "object" &&
        "selectedAt" in raw &&
        typeof raw.selectedAt === "number" &&
        Number.isFinite(raw.selectedAt) &&
        "concept" in raw &&
        ["spotlight", "collection", "hope", "journey"].includes(
          String(raw.concept),
        )
      )
        previous = raw as DiscoveryRotation
    } catch {
      previous = null
    }
    const next = selectGoogleTvDiscovery(
      googleTvDiscoveryCandidates(personalized),
      previous,
      Date.now(),
    )
    if (!next)
      return unavailable(
        "No supported film metadata is available for discovery yet.",
        status.environment,
      )
    if (generation !== getRecommendationGeneration())
      return unavailable(
        "Recommendation settings changed. Please retry.",
        status.environment,
      )
    await getStorage().setItem(ROTATION_KEY, JSON.stringify(next.rotation))
    if (generation !== getRecommendationGeneration())
      return unavailable(
        "Recommendation settings changed. Please retry.",
        status.environment,
      )
    return module.publish(
      next.selection.videos,
      true,
      next.selection.title,
      false,
    )
  })
}
