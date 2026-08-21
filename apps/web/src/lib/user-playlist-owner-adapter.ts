import type {
  UserPlaylist,
  UserPlaylistBlock,
  UserPlaylistSummary,
} from "@/lib/user-playlist-contract"

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

export function adaptUserPlaylistSummary(
  value: unknown,
): UserPlaylistSummary | null {
  const row = object(value)
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.title !== "string" ||
    typeof row.description !== "string" ||
    typeof row.locale !== "string" ||
    (row.countryCode !== null && typeof row.countryCode !== "string") ||
    typeof row.version !== "number" ||
    typeof row.shared !== "boolean"
  ) {
    return null
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    locale: row.locale,
    countryCode: row.countryCode,
    version: row.version,
    shareState: row.shared ? "SHARED" : "UNSHARED",
  }
}

function adaptUserPlaylistBlock(value: unknown): UserPlaylistBlock | null {
  const row = object(value)
  if (!row || typeof row.__typename !== "string") return null
  if (row.__typename === "UserPlaylistTextBlock") {
    return typeof row.text === "string"
      ? { kind: "TEXT", text: row.text }
      : null
  }
  if (
    row.__typename !== "UserPlaylistMediaCollectionBlock" &&
    row.__typename !== "UserPlaylistVideoCarouselBlock"
  ) {
    return null
  }
  if (!Array.isArray(row.items)) return null
  const items: Array<{ videoId: string }> = []
  for (const item of row.items) {
    const media = object(item)
    if (!media || typeof media.videoId !== "string") return null
    items.push({ videoId: media.videoId })
  }
  return {
    kind:
      row.__typename === "UserPlaylistMediaCollectionBlock"
        ? "MEDIA_COLLECTION"
        : "VIDEO_CAROUSEL",
    title: typeof row.title === "string" ? row.title : "",
    items,
  }
}

export function adaptOwnerUserPlaylist(value: unknown): UserPlaylist | null {
  const base = adaptUserPlaylistSummary(value)
  const row = object(value)
  if (
    !base ||
    !row ||
    !Array.isArray(row.blocks) ||
    !Array.isArray(row.unavailableVideoIds) ||
    !row.unavailableVideoIds.every((id) => typeof id === "string")
  ) {
    return null
  }
  const blocks: UserPlaylistBlock[] = []
  for (const input of row.blocks) {
    const mapped = adaptUserPlaylistBlock(input)
    if (!mapped) return null
    blocks.push(mapped)
  }
  return {
    ...base,
    blocks,
    unavailableVideoIds: row.unavailableVideoIds as string[],
  }
}
