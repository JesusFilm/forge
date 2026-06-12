// SYNC: ported from apps/mobile/src/hooks/useBibleVerses.ts (web has the same
// logic in apps/web/src/components/watch/BibleQuotesSection.tsx).
//
// The bibleCitations projection only carries reference fields (book / chapter /
// verse) — no verse text — so the text is fetched client-side per citation from
// the wldeh/bible-api mirror on jsdelivr (single-verse JSON). TV differs from
// mobile in one way: card assembly (stock images, promo card) lives in the pure
// buildBibleQuotesBlock adapter (detailsAdapters.ts) so it stays unit-testable;
// this hook ONLY resolves verse text, keyed by citation documentId. The pure
// fetch helpers live in lib/bibleVerses.ts (tested there — jest-expo can't load
// React-importing modules).
//
// TV is hardcoded English ({ locale: "en" }, see CLAUDE.md), so the translation
// is pinned to en-webbe — mobile's DEFAULT_BIBLE_VERSION — with no locale map.

import { useEffect, useState } from "react"

import {
  bookSlugForApi,
  formatScripture,
  isFetchedScripture,
} from "../lib/bibleVerses"
import type { WatchBibleCitation } from "../lib/normalizeVideo"

// WEBBE renders the divine name as "the LORD" (NIV/ESV convention) rather than
// "Yahweh" — same choice as mobile/web.
const BIBLE_API_VERSION = "en-webbe"

// Wall-clock budget per verse fetch, mirroring web's VERSE_FETCH_TIMEOUT_MS —
// a hanging CDN connection must not hold a slot indefinitely (the card simply
// stays reference-only). Mobile's hook predates this guard; web is the template.
const VERSE_FETCH_TIMEOUT_MS = 8000

/**
 * Fetch each citation's verse text (verseStart, or verse 1 for chapter-only
 * citations — same preview rule as web). Returns a map keyed by citation
 * documentId; missing entries mean the verse is unavailable and the card
 * falls back to reference-only.
 */
export function useBibleVerses(
  citations: readonly WatchBibleCitation[],
): Record<string, string> {
  const [verses, setVerses] = useState<Record<string, string>>({})

  useEffect(() => {
    if (citations.length === 0) return

    let cancelled = false
    // One controller per in-flight fetch so a single slow verse only kills its
    // own request (timeout) and unmount aborts whatever is still running.
    const controllers = new Set<AbortController>()

    void (async () => {
      const fetched: Record<string, string> = {}

      await Promise.all(
        citations.map(async (c) => {
          if (c.bookName == null || c.chapterStart == null) return
          const bookSlug = bookSlugForApi(c.bookName)
          if (bookSlug == null) return

          const verse = c.verseStart ?? 1
          const url = `https://cdn.jsdelivr.net/gh/wldeh/bible-api/bibles/${BIBLE_API_VERSION}/books/${bookSlug}/chapters/${c.chapterStart}/verses/${verse}.json`

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
            if (isFetchedScripture(data)) {
              fetched[c.documentId] = formatScripture(data.text)
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

      if (!cancelled) {
        setVerses(fetched)
      }
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
