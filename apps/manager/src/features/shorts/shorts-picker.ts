export type PickerVideo = {
  id: string
  title: string
  slug: string | null
  imageUrl: string | null
  label: string
}

export type VideosApiItem = {
  id: string
  title: string
  slug?: string | null
  imageUrl: string | null
  label: string
}

export type VideosApiResponse = {
  collections: Array<VideosApiItem & { videos: VideosApiItem[] }>
  standalone: VideosApiItem[]
}

function isSelectableSourceVideo(item: VideosApiItem): boolean {
  return item.label.trim().toLowerCase() !== "collection"
}

export function flattenPickerVideos(payload: VideosApiResponse): PickerVideo[] {
  const byId = new Map<string, PickerVideo>()
  const add = (item: VideosApiItem) => {
    if (!isSelectableSourceVideo(item) || byId.has(item.id)) return

    byId.set(item.id, {
      id: item.id,
      title: item.title,
      slug: item.slug ?? null,
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
