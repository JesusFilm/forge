export type RawMediaItem = {
  aiGenerated: boolean | null
  language: { coreId: string | null } | null
}

export type RawImage = {
  thumbnail: string | null
  videoStill: string | null
}

export type RawVideoNode = {
  documentId: string
  coreId: string | null
  title: string | null
  label: string | null
  slug: string | null
  aiMetadata: boolean | null
  images: RawImage[] | null
  parents: Array<{ documentId: string }> | null
  variants: RawMediaItem[] | null
  subtitles: RawMediaItem[] | null
}

export type CoverageStatus = "human" | "ai" | "none"

export type VideoItem = {
  id: string
  title: string
  imageUrl: string | null
  label: string
  coverage: {
    subtitles: CoverageStatus
    audio: CoverageStatus
    meta: CoverageStatus
  }
  variantLanguageIds: string[]
  subtitleLanguageIds: string[]
}

export type VideoCollection = {
  id: string
  title: string
  label: string
  labelDisplay: string
  videos: VideoItem[]
}

const LABEL_DISPLAY: Record<string, string> = {
  collection: "Collection",
  episode: "Episode",
  featureFilm: "Feature Film",
  segment: "Segment",
  series: "Series",
  shortFilm: "Short Film",
  trailer: "Trailer",
  behindTheScenes: "Behind the Scenes",
  unknown: "Other",
}

export function determineCoverageForItems(
  items: RawMediaItem[],
  selectedLanguageIds: Set<string>,
): CoverageStatus {
  const matching =
    selectedLanguageIds.size === 0
      ? items.filter((item) => item.language?.coreId)
      : items.filter(
          (item) =>
            item.language?.coreId &&
            selectedLanguageIds.has(item.language.coreId),
        )

  if (matching.length === 0) return "none"

  const allAi = matching.every((item) => item.aiGenerated)
  return allAi ? "ai" : "human"
}

export function determineCoverage(
  video: RawVideoNode,
  selectedLanguageIds: Set<string>,
): VideoItem["coverage"] {
  return {
    subtitles: determineCoverageForItems(
      video.subtitles ?? [],
      selectedLanguageIds,
    ),
    audio: determineCoverageForItems(video.variants ?? [], selectedLanguageIds),
    meta:
      video.aiMetadata === true
        ? "ai"
        : video.aiMetadata === false
          ? "human"
          : "none",
  }
}

function toVideoItem(
  video: RawVideoNode,
  selectedLanguageIds: Set<string>,
): VideoItem {
  const variantLanguageIds = (video.variants ?? [])
    .map((v) => v.language?.coreId)
    .filter((id): id is string => id != null)
  const subtitleLanguageIds = (video.subtitles ?? [])
    .map((s) => s.language?.coreId)
    .filter((id): id is string => id != null)

  const firstImage = (video.images ?? []).find(
    (img) => img.thumbnail || img.videoStill,
  )
  const imageUrl = firstImage?.thumbnail ?? firstImage?.videoStill ?? null

  return {
    id: String(video.coreId ?? video.documentId),
    title:
      video.title ?? video.slug ?? String(video.coreId ?? video.documentId),
    imageUrl,
    label: video.label ?? "unknown",
    coverage: determineCoverage(video, selectedLanguageIds),
    variantLanguageIds,
    subtitleLanguageIds,
  }
}

export function buildVideoCollections(
  videoNodes: RawVideoNode[],
  selectedLanguageIds: Set<string>,
): VideoCollection[] {
  const videoMap = new Map(videoNodes.map((v) => [v.documentId, v]))
  const parentChildrenMap = new Map<string, RawVideoNode[]>()

  for (const video of videoNodes) {
    for (const parent of video.parents ?? []) {
      let children = parentChildrenMap.get(parent.documentId)
      if (!children) {
        children = []
        parentChildrenMap.set(parent.documentId, children)
      }
      children.push(video)
    }
  }

  const collections: VideoCollection[] = []
  const includedChildDocIds = new Set<string>()

  for (const [parentDocId, children] of parentChildrenMap) {
    const parent = videoMap.get(parentDocId)
    if (!parent) continue

    for (const child of children) {
      includedChildDocIds.add(child.documentId)
    }

    collections.push({
      id: String(parent.coreId ?? parent.documentId),
      title:
        parent.title ??
        parent.slug ??
        String(parent.coreId ?? parent.documentId),
      label: parent.label ?? "unknown",
      labelDisplay:
        LABEL_DISPLAY[parent.label ?? "unknown"] ?? parent.label ?? "unknown",
      videos: children.map((child) => toVideoItem(child, selectedLanguageIds)),
    })
  }

  const standalone = videoNodes.filter(
    (video) =>
      !includedChildDocIds.has(video.documentId) &&
      !parentChildrenMap.has(video.documentId),
  )

  if (standalone.length > 0) {
    collections.push({
      id: "standalone",
      title: "Standalone Videos",
      label: "standalone",
      labelDisplay: "Standalone",
      videos: standalone.map((video) =>
        toVideoItem(video, selectedLanguageIds),
      ),
    })
  }

  return collections
}
