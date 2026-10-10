// SYNC: ported from apps/mobile/src/hooks/useBibleVerses.ts. Verse text is fetched
// client-side per citation from wldeh/bible-api on jsdelivr (keyed by documentId,
// version pinned en-webbe); a module-scope cache (bibleVerseFetch) dedupes across mounts.

import { useEffect, useState } from "react"

import {
  bookSlugForApi,
  formatScripture,
  isFetchedScripture,
} from "../lib/bibleVerses"
import {
  buildVerseUrl,
  cacheVerse,
  getCachedVerse,
  partitionVerses,
} from "../lib/bibleVerseFetch"
import type { WatchBibleCitation } from "../lib/normalizeVideo"

// WEBBE renders the divine name as "the LORD" (NIV/ESV convention) rather than
// "Yahweh" — same choice as mobile/web.
const BIBLE_API_VERSION = "en-webbe"

// Wall-clock budget per verse fetch, mirroring web's VERSE_FETCH_TIMEOUT_MS —
// a hanging CDN connection must not hold a slot indefinitely (the card simply
// stays reference-only). Mobile's hook predates this guard; web is the template.
const VERSE_FETCH_TIMEOUT_MS = 8000

/**
 * Fetch each citation's verse text (verseStart, or verse 1 for chapter-only —
 * web's preview rule). Returns a map keyed by documentId; a missing entry means
 * the verse is unavailable and the card falls back to reference-only.
 */
export function useBibleVerses(
  citations: readonly WatchBibleCitation[],
): Record<string, string> {
  const [verses, setVerses] = useState<Record<string, string>>({})

  useEffect(() => {
    if (citations.length === 0) return

    // Resolve each citation to its verse URL (null = unfetchable book/chapter).
    const citationUrls = citations.map((c) => {
      if (c.bookName == null || c.chapterStart == null) {
        return { documentId: c.documentId, url: null }
      }
      const bookSlug = bookSlugForApi(c.bookName)
      if (bookSlug == null) return { documentId: c.documentId, url: null }
      const verse = c.verseStart ?? 1
      return {
        documentId: c.documentId,
        url: buildVerseUrl(BIBLE_API_VERSION, bookSlug, c.chapterStart, verse),
      }
    })

    // Seed from the module cache; only the deduped uncached URLs hit the network.
    const { resolved, toFetch } = partitionVerses(citationUrls)
    if (toFetch.size === 0) {
      setVerses(resolved)
      return
    }

    let cancelled = false
    // One controller per in-flight fetch so a single slow verse only kills its
    // own request (timeout) and unmount aborts whatever is still running.
    const controllers = new Set<AbortController>()

    void (async () => {
      await Promise.all(
        [...toFetch].map(async (url) => {
          const controller = new AbortController()
          controllers.add(controller)
          const timeoutId = setTimeout(() => {
            controller.abort()
          }, VERSE_FETCH_TIMEOUT_MS)

          try {
            // No `cache` option: RN's whatwg-fetch polyfill silently ignores
            // "force-cache"; OS-level HTTP caching still applies.
            const res = await fetch(url, { signal: controller.signal })
            if (cancelled || !res.ok) return
            const data: unknown = await res.json()
            if (cancelled) return
            // Cache only on success, so a failed/aborted fetch retries next mount.
            if (isFetchedScripture(data)) {
              cacheVerse(url, formatScripture(data.text))
            }
          } catch (error) {
            // AbortError = timeout or unmount — expected; the card stays
            // reference-only. Anything else (network, JSON parse) is logged so
            // a CDN regression is visible instead of silently degrading.
            if (cancelled) return
            if (error instanceof Error && error.name === "AbortError") return
            console.warn("[useBibleVerses] verse fetch failed", { url }, error)
          } finally {
            clearTimeout(timeoutId)
            controllers.delete(controller)
          }
        }),
      )

      if (cancelled) return
      // Merge cache-seeded text with whatever just landed, keyed by documentId
      // (two citations may resolve to the same verse URL).
      const merged: Record<string, string> = { ...resolved }
      for (const { documentId, url } of citationUrls) {
        if (url == null || merged[documentId] != null) continue
        const text = getCachedVerse(url)
        if (text != null) merged[documentId] = text
      }
      setVerses(merged)
    })()

    return () => {
      cancelled = true
      for (const controller of controllers) {
        controller.abort()
      }
    }
  }, [citations])

  return verses
}
