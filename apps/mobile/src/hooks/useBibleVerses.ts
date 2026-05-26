import { useEffect, useState } from "react"

import type { WatchBibleCitation } from "../lib/normalizeVideo"

const JOIN_BIBLE_STUDY_URL =
  "https://join.bsfinternational.org/?utm_source=jesusfilm-watch"
const PROMO_IMAGE_URL =
  "https://images.unsplash.com/photo-1650658720644-e1588bd66de3?w=900&auto=format&fit=crop&q=60"

const BIBLE_CARDS = [
  {
    url: "https://images.unsplash.com/photo-1480869799327-03916a613b29?q=80&w=800&auto=format&fit=crop",
    color: "#2a4a5e",
  },
  {
    url: "https://images.unsplash.com/16/unsplash_526360a842e20_1.JPG?q=80&w=800&auto=format&fit=crop",
    color: "#3d5a3a",
  },
  {
    url: "https://images.unsplash.com/photo-1497333558196-daaff02b56d0?q=80&w=800&auto=format&fit=crop",
    color: "#4a6741",
  },
  {
    url: "https://images.unsplash.com/photo-1555892727-55b51e5fceae?q=80&w=800&auto=format&fit=crop",
    color: "#5b4a6b",
  },
  {
    url: "https://images.unsplash.com/photo-1631125915973-e0d155a14e4e?q=80&w=800&auto=format&fit=crop",
    color: "#6b5a3a",
  },
  {
    url: "https://images.unsplash.com/photo-1659260145900-1ac1afc45dcf?q=80&w=800&auto=format&fit=crop",
    color: "#c0784a",
  },
  {
    url: "https://images.unsplash.com/photo-1535979863199-3c77338429a0?q=80&w=800&auto=format&fit=crop",
    color: "#3a4e6b",
  },
] as const

type BibleVersion = { bibleApi: string; bibleGateway: string }

const DEFAULT_BIBLE_VERSION: BibleVersion = {
  bibleApi: "en-webbe",
  bibleGateway: "WEB",
}

const BOOK_SLUG_PATTERN = /^[a-z0-9-]+$/

function bookSlugForApi(rawBookName: string): string | null {
  const slug = rawBookName.toLowerCase().replace(/\s+/g, "")
  return BOOK_SLUG_PATTERN.test(slug) ? slug : null
}

function formatScripture(verse: string): string {
  return verse
    .replace(/;\d[\s\S]*/, "")
    .replace(/,\d:\d[\s\S]*/, "")
    .replace(/\n/g, " ")
    .trim()
}

function isFetchedScripture(value: unknown): value is { text: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "text" in value &&
    typeof (value as { text: unknown }).text === "string" &&
    (value as { text: string }).text.length > 0
  )
}

export type BibleQuoteBlock = {
  reference: string
  text: string
  attribution: string | null
  imageUrl: string | null
  backgroundColor: string | null
  ctaLabel: string | null
  ctaLink: string | null
}

export function useBibleVerses(
  citations: WatchBibleCitation[],
): BibleQuoteBlock[] {
  const [verses, setVerses] = useState<Record<string, string>>({})

  useEffect(() => {
    if (citations.length === 0) return

    let cancelled = false
    const { bibleApi } = DEFAULT_BIBLE_VERSION

    void (async () => {
      const fetched: Record<string, string> = {}

      await Promise.all(
        citations.map(async (c) => {
          if (c.bookName == null || c.chapterStart == null) return
          const bookSlug = bookSlugForApi(c.bookName)
          if (bookSlug == null) return

          const verse = c.verseStart ?? 1
          const key = c.documentId

          try {
            const url = `https://cdn.jsdelivr.net/gh/wldeh/bible-api/bibles/${bibleApi}/books/${bookSlug}/chapters/${c.chapterStart}/verses/${verse}.json`
            const res = await fetch(url, { cache: "force-cache" })
            if (cancelled || !res.ok) return
            const data: unknown = await res.json()
            if (cancelled) return
            if (isFetchedScripture(data)) {
              fetched[key] = formatScripture(data.text)
            }
          } catch {
            // Verse unavailable for this translation
          }
        }),
      )

      if (!cancelled) {
        setVerses(fetched)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [citations])

  const quoteCards: BibleQuoteBlock[] = citations.map((c, i) => {
    const ref = c.bookName
      ? `${c.bookName} ${c.chapterStart ?? ""}:${c.verseStart ?? ""}`
      : (c.osisId ?? "")
    const cardData = BIBLE_CARDS[i % BIBLE_CARDS.length]

    return {
      reference: ref,
      text: verses[c.documentId] ?? "",
      attribution: null,
      imageUrl: cardData?.url ?? null,
      backgroundColor: cardData?.color ?? null,
      ctaLabel: null,
      ctaLink: null,
    }
  })

  quoteCards.push({
    reference: "FREE RESOURCES",
    text: "Want to explore life's biggest questions?",
    attribution: null,
    imageUrl: PROMO_IMAGE_URL,
    backgroundColor: null,
    ctaLabel: "Join Our Bible Study",
    ctaLink: JOIN_BIBLE_STUDY_URL,
  })

  return quoteCards
}
