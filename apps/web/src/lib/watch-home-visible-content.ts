import type { Section } from "@/lib/content"
import { enrichMediaItem } from "@/lib/enrichment"
import {
  WATCH_BASE_PATH,
  WATCH_PUBLIC_METADATA_ORIGIN,
  tryAsContentSlug,
  tryAsLocaleSlug,
  watchVideoPath,
} from "@/lib/routes"
import { buildWatchHomeVideoQueue } from "@/lib/watch-home-carousel-sequence"
import type { WatchHomeModel } from "@/lib/watch-home"

export type WatchHomeVisibleDestination = {
  name: string
  url: string
}

type BlockRecord = {
  __typename?: string | null
  t?: string | null
  itemsSource?: string | null
  items?: Parameters<typeof enrichMediaItem>[0][] | null
  content?: readonly unknown[] | null
  sectionContent?: readonly unknown[] | null
  slots?: readonly { content?: readonly unknown[] | null }[] | null
}

function watchDestinationUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value, WATCH_PUBLIC_METADATA_ORIGIN)
    if (
      url.origin !== WATCH_PUBLIC_METADATA_ORIGIN ||
      (url.pathname !== WATCH_BASE_PATH &&
        !url.pathname.startsWith(`${WATCH_BASE_PATH}/`))
    ) {
      return null
    }
    return `${url.origin}${url.pathname}`
  } catch {
    return null
  }
}

function initialHeroDestination(
  model: WatchHomeModel,
): WatchHomeVisibleDestination | null {
  const queue = buildWatchHomeVideoQueue({
    pools: model.carousel.pools,
    startPoolIndex: 0,
    targetVideoCount: 7,
    useStoredProgress: false,
  })
  const selected =
    queue.videos.find((slide) => slide.src && slide.href) ??
    model.heroSlides.find((slide) => slide.href)

  if (!selected?.href || !("title" in selected)) return null
  const url = watchDestinationUrl(selected.href)
  const name = selected.title?.trim()
  return url && name ? { name, url } : null
}

function mediaCollectionDestinations(
  block: BlockRecord,
  fallbackLanguageSlug: string,
): WatchHomeVisibleDestination[] {
  if (block.itemsSource === "routeVideoChildren") return []

  return (block.items ?? []).flatMap((item) => {
    const enriched = enrichMediaItem(item)
    const slug = tryAsContentSlug(enriched.videoSlug)
    const language =
      tryAsLocaleSlug(enriched.languageSlug ?? "") ??
      tryAsLocaleSlug(fallbackLanguageSlug)
    const name = enriched.title.trim()
    if (!slug || !language || !name) return []
    return [
      {
        name,
        url: `${WATCH_PUBLIC_METADATA_ORIGIN}${WATCH_BASE_PATH}${watchVideoPath(slug, language)}`,
      },
    ]
  })
}

function isKind(block: BlockRecord, ...kinds: string[]): boolean {
  return kinds.includes(block.__typename ?? "") || kinds.includes(block.t ?? "")
}

function visibleContainerChildren(block: BlockRecord): readonly unknown[] {
  if (block.slots?.length) {
    return block.slots.flatMap((slot) => slot.content ?? [])
  }

  const visible: unknown[] = []
  let insideSlot = false
  for (const child of block.content ?? []) {
    if (!child || typeof child !== "object") continue
    const record = child as BlockRecord
    if (isKind(record, "ContainerSlotBlock", "containerSlot")) {
      insideSlot = true
    } else if (insideSlot) {
      visible.push(child)
    }
  }
  return visible
}

function authoredDestinations(
  blocks: readonly unknown[],
  fallbackLanguageSlug: string,
): WatchHomeVisibleDestination[] {
  const result: WatchHomeVisibleDestination[] = []

  for (const value of blocks) {
    if (!value || typeof value !== "object") continue
    const block = value as BlockRecord
    if (
      isKind(
        block,
        "MediaCollectionBlock",
        "ComponentSectionsMediaCollection",
        "mediaCollection",
      )
    ) {
      result.push(...mediaCollectionDestinations(block, fallbackLanguageSlug))
    } else if (
      isKind(block, "ContainerBlock", "ComponentSectionsContainer", "container")
    ) {
      result.push(
        ...authoredDestinations(
          visibleContainerChildren(block),
          fallbackLanguageSlug,
        ),
      )
    } else if (
      isKind(block, "SectionBlock", "ComponentSectionsSection", "section")
    ) {
      result.push(
        ...authoredDestinations(
          block.sectionContent ?? block.content ?? [],
          fallbackLanguageSlug,
        ),
      )
    }
  }

  return result
}

export function projectWatchHomeVisibleContent({
  model,
  blocks,
  languageSlug,
}: {
  model: WatchHomeModel
  blocks: readonly Section[]
  languageSlug: string
}): {
  blocks: readonly Section[]
  destinations: WatchHomeVisibleDestination[]
} {
  const hero = initialHeroDestination(model)
  return {
    blocks,
    destinations: [
      ...(hero ? [hero] : []),
      ...authoredDestinations(blocks, languageSlug),
    ],
  }
}
