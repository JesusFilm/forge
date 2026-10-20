import { Platform, AppState } from "react-native"
import { adminGraphql } from "@forge/admin-graphql"
import { getApolloClient } from "../apolloClient"
import { getStorage } from "../safeStorage"
import { validateStreamingUrl } from "../validateUrl"
import {
  isResumeWorthy,
  type ContinueWatchingEntry,
} from "../watchEvents/continueWatching"
import type { WatchHomeModel, WatchHomeCard } from "../watchHome/model"
import { topShelf } from "../../../modules/top-shelf"
import {
  fetchForYou,
  recommendationsEnabled,
  getRecommendationGeneration,
} from "../recommendations/client"
import {
  itemSchema,
  snapshotSchema,
  selectConcept,
  parseRotation,
  localDay,
  type Concept,
  type ShelfItem,
} from "./model"
import {
  topShelfPreviewEnabled,
  shelfConceptForPreview,
  type TopShelfPreviewStyle,
} from "./preview"

const VIDEO =
  adminGraphql(`query TopShelfVideo($slug: String!, $languageSlug: String!) {
  videoBySlug(slug: $slug) {
    id slug durationSeconds
    locales(locale: "en") { title snippet }
    images { mobileCinematicHigh thumbnail url }
    preferredPlayableDub(languageSlug: $languageSlug) { published hls language { slug } }
  }
}`)
const ROTATION_KEY = "watch.top-shelf.rotation.v1"
const SNAPSHOT_KEY = "watch.top-shelf.snapshot.v1"
const CATALOG_KEY = "watch.top-shelf.catalog.v1"
function storedJson(raw: string | null): unknown {
  try {
    return JSON.parse(raw ?? "null")
  } catch {
    return null
  }
}
let active: AbortController | null = null

export function shelfCandidates(model: WatchHomeModel): WatchHomeCard[] {
  const cards = [
    ...model.featured,
    ...model.sections.flatMap((section) => section.cards),
  ].filter(
    (card) =>
      card.slug && !["SERIES", "COLLECTION"].includes(card.rawLabel ?? ""),
  )
  const short = cards.find((card) => card.rawLabel === "SHORT_FILM")
  return [
    ...new Map(
      [...(short ? [short] : []), ...cards].map((card) => [card.slug, card]),
    ).values(),
  ].slice(0, 4)
}

export function stopTopShelfSync() {
  active?.abort()
  active = null
}
export async function clearPersonalTopShelf() {
  stopTopShelfSync()
  await getStorage().removeItem(CATALOG_KEY)
  await getStorage().removeItem(SNAPSHOT_KEY)
  await topShelf?.clearSnapshot()
}
export async function invalidateTopShelfLanguage(language: string) {
  if (!topShelf) return
  const storage = getStorage()
  const previous = snapshotSchema.safeParse(
    storedJson(await storage.getItem(SNAPSHOT_KEY)),
  )
  if (!previous.success || previous.data.language === language) return
  stopTopShelfSync()
  const now = new Date()
  const empty = snapshotSchema.parse({
    schemaVersion: 1,
    concept: "spotlight",
    language,
    source: recommendationsEnabled() ? "recommendations" : "editorial",
    generatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 86400000).toISOString(),
    items: [],
  })
  await topShelf.writeSnapshot(JSON.stringify(empty))
  await storage.setItem(SNAPSHOT_KEY, JSON.stringify(empty))
  await storage.removeItem(CATALOG_KEY)
}

export async function syncTopShelf(
  model: WatchHomeModel,
  resume: ContinueWatchingEntry[],
  language: string,
  previewStyle: TopShelfPreviewStyle = "automatic",
  onPreviewStatus?: (message: string) => void,
) {
  if (
    Platform.OS !== "ios" ||
    !Platform.isTV ||
    !topShelf ||
    AppState.currentState !== "active"
  ) {
    onPreviewStatus?.(
      !topShelf
        ? "Top Shelf native bridge is unavailable."
        : "Return to Watch to update Top Shelf.",
    )
    return
  }
  stopTopShelfSync()
  const controller = new AbortController()
  active = controller
  const deadline = setTimeout(() => {
    controller.abort()
    onPreviewStatus?.("Top Shelf update timed out. Select the style to retry.")
  }, 12000)
  const now = new Date()
  const privacyGeneration = getRecommendationGeneration()
  const isCurrent = () =>
    !controller.signal.aborted &&
    active === controller &&
    privacyGeneration === getRecommendationGeneration() &&
    AppState.currentState === "active"
  let phase = "recommendations"
  onPreviewStatus?.("Updating Top Shelf…")
  try {
    const storage = getStorage()
    const recommendationVideos: ShelfItem[] = []
    if (recommendationsEnabled()) {
      const delivery = await fetchForYou(language)
      if (!isCurrent()) return
      if (delivery.result === "unavailable") {
        onPreviewStatus?.(
          "Recommendations are unavailable. Try Automatic again.",
        )
        return
      }
      for (const recommended of [...delivery.items].sort(
        (a, b) => a.position - b.position,
      )) {
        const item = itemSchema.safeParse({
          id: recommended.targetMediaId,
          slug: recommended.videoSlug,
          title: recommended.videoTitle.slice(0, 200),
          summary: (recommended.description ?? "").slice(0, 500),
          imageURL: recommended.imageUrl,
          duration: recommended.durationSeconds ?? 0,
          kind: "video",
        })
        if (item.success) recommendationVideos.push(item.data)
      }
    }
    const slugs = [
      ...new Set([
        ...(recommendationsEnabled()
          ? []
          : shelfCandidates(model).map((card) => card.slug!)),
        ...resume.filter(isResumeWorthy).map((entry) => entry.slug),
      ]),
    ].slice(0, 8)
    phase = "video information"
    const verified: ShelfItem[] = []
    const previous = snapshotSchema.safeParse(
      storedJson(await storage.getItem(SNAPSHOT_KEY)),
    )
    const unavailableSlugs = new Set<string>()
    let metadataFailed = false
    // The native snapshot is the offline fallback. A second day-long catalogue
    // hid same-day copy/artwork/publication edits, including after app restart.
    // Revalidate only this bounded set during an existing foreground sync.
    for (const slug of slugs) {
      if (!isCurrent()) return
      let response
      try {
        response = await getApolloClient().query({
          query: VIDEO,
          variables: { slug, languageSlug: language },
          fetchPolicy: "network-only",
          context: {
            queryDeduplication: false,
            fetchOptions: { signal: controller.signal },
          },
        })
      } catch {
        if (!isCurrent()) return
        metadataFailed = true
        continue
      }
      if (!isCurrent()) return
      const video = response.data?.videoBySlug
      const dub = video?.preferredPlayableDub
      if (
        !video?.slug ||
        !dub?.published ||
        dub.language?.slug !== language ||
        !validateStreamingUrl(dub.hls)
      ) {
        unavailableSlugs.add(slug)
        continue
      }
      const artwork = video.images?.find(
        (image) => image.mobileCinematicHigh || image.thumbnail || image.url,
      )
      const item = itemSchema.safeParse({
        id: video.id,
        slug: video.slug,
        title: video.locales?.[0]?.title ?? video.slug,
        summary: video.locales?.[0]?.snippet ?? "",
        imageURL:
          artwork?.mobileCinematicHigh ?? artwork?.thumbnail ?? artwork?.url,
        duration: video.durationSeconds ?? 0,
        kind: "video",
      })
      if (item.success) verified.push(item.data)
      else unavailableSlugs.add(slug)
    }
    if (metadataFailed) {
      // Keep unknown data only within its original expiry, but never preserve a
      // film that this refresh positively confirmed removed or unplayable.
      if (
        previous.success &&
        previous.data.language === language &&
        previous.data.expiresAt > now.toISOString()
      ) {
        const resumeSlugs = new Set(
          resume.filter(isResumeWorthy).map((entry) => entry.slug),
        )
        const sectionIds = new Set(model.sections.map((section) => section.id))
        const items = previous.data.items.filter((item) =>
          item.kind === "section"
            ? sectionIds.has(item.id)
            : !unavailableSlugs.has(item.slug) &&
              (previous.data.concept !== "continue" ||
                resumeSlugs.has(item.slug)),
        )
        if (items.length !== previous.data.items.length && isCurrent()) {
          const retained = JSON.stringify({ ...previous.data, items })
          await topShelf.writeSnapshot(retained)
          if (!isCurrent()) return
          await storage.setItem(SNAPSHOT_KEY, retained)
        }
      }
      if (isCurrent())
        onPreviewStatus?.(
          "Could not update Top Shelf (video information). Try again.",
        )
      return
    }
    const continued = resume.flatMap((entry) => {
      const video = verified.find((item) => item.slug === entry.slug)
      return video &&
        isResumeWorthy({
          positionSeconds: entry.positionSeconds,
          durationSeconds: entry.durationSeconds ?? video.duration,
        })
        ? [
            {
              ...video,
              progress: Math.min(
                1,
                entry.positionSeconds /
                  (entry.durationSeconds || video.duration || 1),
              ),
            },
          ]
        : []
    })
    const discovery = (
      recommendationsEnabled() ? recommendationVideos : verified
    ).filter(
      (item) =>
        !unavailableSlugs.has(item.slug) &&
        !continued.some((entry) => entry.slug === item.slug),
    )
    const journeys: ShelfItem[] = []
    for (const section of model.sections) {
      const artwork = discovery.find((video) =>
        section.cards.some((card) => card.slug === video.slug),
      )
      if (
        artwork &&
        /hope|faith|forgiv|journey|peace|christ|happy|questions|jesus/i.test(
          section.title,
        )
      ) {
        const topic = itemSchema.safeParse({
          ...artwork,
          id: section.id,
          slug: section.id,
          title: section.title,
          summary: (section.description ?? "Explore this collection").slice(
            0,
            500,
          ),
          kind: "section",
          duration: 0,
        })
        if (topic.success) journeys.push(topic.data)
      }
      if (journeys.length >= 3) break
    }
    const pools: Record<Concept, ShelfItem[]> = {
      spotlight: discovery.slice(0, 3),
      continue: continued,
      collection: discovery.length >= 2 ? discovery : [],
      short: discovery.filter(
        (item) => item.duration > 0 && item.duration <= 900,
      ),
      journey: journeys.filter((item) => itemSchema.safeParse(item).success),
    }
    const eligible = (Object.keys(pools) as Concept[]).filter(
      (concept) => pools[concept].length,
    )
    const rotation = selectConcept(
      eligible,
      parseRotation(await storage.getItem(ROTATION_KEY)),
      localDay(now),
    )
    const previewEnabled = topShelfPreviewEnabled(
      process.env.EXPO_PUBLIC_TV_TOP_SHELF_PREVIEW_ENABLED,
      Platform.OS,
      Platform.isTV,
    )
    const concept = shelfConceptForPreview(
      eligible,
      rotation?.concept,
      previewEnabled ? previewStyle : "automatic",
    )
    const overriding =
      previewEnabled && previewStyle !== "automatic" && concept === previewStyle
    const items = concept ? pools[concept] : []
    const content = {
      schemaVersion: 1 as const,
      concept: concept ?? ("spotlight" as const),
      language,
      source: recommendationsEnabled()
        ? ("recommendations" as const)
        : ("editorial" as const),
      items,
    }
    const unchanged =
      previous.success &&
      previous.data.expiresAt > now.toISOString() &&
      JSON.stringify({
        ...previous.data,
        generatedAt: undefined,
        expiresAt: undefined,
      }) === JSON.stringify(content)
    const snapshot =
      unchanged && previous.success
        ? previous.data
        : snapshotSchema.parse({
            ...content,
            generatedAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + 86400000).toISOString(),
          })
    if (!isCurrent()) return
    phase = "native shelf"
    await topShelf.writeSnapshot(JSON.stringify(snapshot))
    if (!isCurrent()) return
    if (rotation && !overriding)
      await storage.setItem(ROTATION_KEY, JSON.stringify(rotation))
    if (!isCurrent()) return
    await storage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot))
    if (!isCurrent()) return
    const label =
      concept === previewStyle || previewStyle === "automatic"
        ? "Top Shelf updated. Return to Apple TV Home."
        : "This style has no matching content. Automatic is displayed."
    onPreviewStatus?.(label)
  } catch {
    if (isCurrent())
      onPreviewStatus?.(`Could not update Top Shelf (${phase}). Try again.`)
    // Preserve the last unexpired snapshot; the extension expires it independently.
  } finally {
    clearTimeout(deadline)
    if (active === controller) active = null
  }
}
