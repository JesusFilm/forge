export type SmartCropPickerVideo = {
  id: string
  coreId: string | null
  title: string
  slug: string | null
  imageUrl: string | null
  label: string
}

export type SmartCropVideosApiItem = SmartCropPickerVideo

export type SmartCropVideosApiResponse = {
  collections: Array<
    SmartCropVideosApiItem & { videos: SmartCropVideosApiItem[] }
  >
  standalone: SmartCropVideosApiItem[]
}

const NON_SOURCE_VIDEO_LABELS = new Set(["collection", "series"])

function isSelectableSourceVideo(item: SmartCropVideosApiItem): boolean {
  return !NON_SOURCE_VIDEO_LABELS.has(item.label.trim().toLowerCase())
}

export function flattenSmartCropPickerVideos(
  payload: SmartCropVideosApiResponse,
): SmartCropPickerVideo[] {
  const byId = new Map<string, SmartCropPickerVideo>()
  const add = (item: SmartCropVideosApiItem) => {
    if (!isSelectableSourceVideo(item) || byId.has(item.id)) return

    byId.set(item.id, {
      id: item.id,
      coreId: item.coreId,
      title: item.title,
      slug: item.slug,
      imageUrl: item.imageUrl,
      label: item.label,
    })
  }

  for (const collection of payload.collections ?? []) {
    for (const video of collection.videos ?? []) {
      add(video)
    }
  }
  for (const video of payload.standalone ?? []) {
    add(video)
  }

  return [...byId.values()].sort((left, right) =>
    left.title.localeCompare(right.title),
  )
}
