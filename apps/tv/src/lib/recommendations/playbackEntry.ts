export type PlaybackEntry = {
  source: "direct" | "search" | "editorial"
  automatic?: boolean
}
const entries = new Map<string, PlaybackEntry>()
export function rememberPlaybackEntry(slug: string, entry: PlaybackEntry) {
  entries.set(slug, entry)
  if (entries.size > 16) entries.delete(entries.keys().next().value!)
}
export function takePlaybackEntry(slug: string) {
  const entry = entries.get(slug)
  entries.delete(slug)
  return entry
}
