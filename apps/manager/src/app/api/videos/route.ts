import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth"
import {
  type CmsVideoCoverage,
  getFilteredVideoCoverageCache,
  normalizeCoverageLanguageIds,
  videoCache,
} from "./cache"

type CoverageCounts = { human: number; ai: number; none: number }
type CollectionChild = {
  video: CmsVideoCoverage
  order: number | null
  inputIndex: number
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

export async function GET(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const url = new URL(request.url)
  const languageIds = url.searchParams.get("languageIds")?.split(",") ?? []
  const selectedLanguages = normalizeCoverageLanguageIds(languageIds)

  try {
    const videos =
      selectedLanguages.length === 0
        ? await videoCache.get()
        : await getFilteredVideoCoverageCache(selectedLanguages).get()

    const numSelected = selectedLanguages.length

    function toCoverageCounts(counts: {
      human: number
      ai: number
    }): CoverageCounts {
      return {
        human: counts.human,
        ai: counts.ai,
        none:
          numSelected > 0
            ? Math.max(0, numSelected - counts.human - counts.ai)
            : 0,
      }
    }

    function toVideoItem(video: CmsVideoCoverage) {
      return {
        id: String(video.coreId ?? video.documentId),
        coreId: video.coreId ?? null,
        title:
          video.title ?? video.slug ?? String(video.coreId ?? video.documentId),
        slug: video.slug ?? null,
        imageUrl: video.imageUrl,
        label: video.label ?? "unknown",
        coverage: {
          subtitles: toCoverageCounts(video.coverage.subtitles),
          audio: toCoverageCounts(video.coverage.audio),
          meta: {
            human: video.aiMetadata === false ? 1 : 0,
            ai: video.aiMetadata === true ? 1 : 0,
            none: video.aiMetadata == null ? 1 : 0,
          } satisfies CoverageCounts,
        },
      }
    }

    function parentRelationsFor(video: CmsVideoCoverage) {
      if (video.parentRelations != null && video.parentRelations.length > 0) {
        return video.parentRelations
      }

      return video.parentDocumentIds.map((parentDocumentId) => ({
        parentDocumentId,
        order: null,
      }))
    }

    function compareCollectionChildren(
      left: CollectionChild,
      right: CollectionChild,
    ) {
      if (left.order != null || right.order != null) {
        if (left.order == null) return 1
        if (right.order == null) return -1
        if (left.order !== right.order) return left.order - right.order
      }

      const leftTitle = left.video.title ?? left.video.slug ?? ""
      const rightTitle = right.video.title ?? right.video.slug ?? ""
      const titleCompare = leftTitle.localeCompare(rightTitle)
      if (titleCompare !== 0) return titleCompare

      return left.inputIndex - right.inputIndex
    }

    const videoMap = new Map(videos.map((video) => [video.documentId, video]))

    const parentChildrenMap = new Map<string, CollectionChild[]>()
    for (const [inputIndex, video] of videos.entries()) {
      for (const relation of parentRelationsFor(video)) {
        const parentDocId = relation.parentDocumentId
        let children = parentChildrenMap.get(parentDocId)
        if (!children) {
          children = []
          parentChildrenMap.set(parentDocId, children)
        }
        children.push({ video, order: relation.order, inputIndex })
      }
    }

    const collections: Array<{
      id: string
      coreId: string | null
      title: string
      slug: string | null
      imageUrl: string | null
      label: string
      labelDisplay: string
      coverage: {
        subtitles: CoverageCounts
        audio: CoverageCounts
        meta: CoverageCounts
      }
      videos: ReturnType<typeof toVideoItem>[]
    }> = []

    for (const [parentDocId, children] of parentChildrenMap) {
      const parent = videoMap.get(parentDocId)
      if (!parent) continue

      const parentItem = toVideoItem(parent)
      const sortedChildren = [...children].sort(compareCollectionChildren)

      collections.push({
        id: parentItem.id,
        coreId: parentItem.coreId,
        title: parentItem.title,
        slug: parentItem.slug,
        imageUrl: parentItem.imageUrl,
        label: parentItem.label,
        labelDisplay:
          LABEL_DISPLAY[parent.label ?? "unknown"] ?? parent.label ?? "unknown",
        coverage: parentItem.coverage,
        videos: sortedChildren.map((child) => toVideoItem(child.video)),
      })
    }

    collections.sort((left, right) => left.title.localeCompare(right.title))

    const standalone = videos
      .filter(
        (video) =>
          parentRelationsFor(video).length === 0 &&
          !parentChildrenMap.has(video.documentId),
      )
      .map(toVideoItem)

    return NextResponse.json({ collections, standalone })
  } catch (error) {
    console.error(
      "[api/videos] Failed to fetch video data:",
      error instanceof Error ? error.message : "Unknown error",
    )
    return NextResponse.json(
      { error: "Failed to fetch video data" },
      { status: 502 },
    )
  }
}
