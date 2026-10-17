import type { WatchVideoData } from "./videoQueries"

const MAX_ENTRIES = 8
const MAX_AGE_MS = 5 * 60_000

export function createAndroidVideoDetailsCache(
  fetchVideo: (slug: string) => Promise<WatchVideoData>,
  now = Date.now,
) {
  type Entry = {
    data?: WatchVideoData
    expiresAt: number
    pending?: Promise<WatchVideoData>
  }
  const entries = new Map<string, Entry>()
  return {
    read(slug: string): WatchVideoData | undefined {
      const entry = entries.get(slug)
      return entry && entry.expiresAt > now() ? entry.data : undefined
    },
    load(slug: string, refresh = false): Promise<WatchVideoData> {
      const cached = entries.get(slug)
      if (!refresh && cached) {
        entries.delete(slug)
        entries.set(slug, cached)
        if (cached.pending) return cached.pending
        if (cached.data && cached.expiresAt > now())
          return Promise.resolve(cached.data)
      }
      const entry: Entry = { expiresAt: 0 }
      entries.delete(slug)
      entries.set(slug, entry)
      if (entries.size > MAX_ENTRIES)
        entries.delete(entries.keys().next().value!)
      entry.pending = fetchVideo(slug).then(
        (data) => {
          entry.data = data
          entry.expiresAt = now() + MAX_AGE_MS
          entry.pending = undefined
          return data
        },
        (error: unknown) => {
          if (entries.get(slug) === entry) entries.delete(slug)
          throw error
        },
      )
      return entry.pending
    },
  }
}
