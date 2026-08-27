import { useEffect, useMemo, useRef, useState } from "react"

import { getApolloClient } from "../lib/apolloClient"
import {
  clearPassageReadCooldown,
  isPassageReadSuppressed,
  registerPassageReadFailure,
} from "../lib/biblePassageCooldown"
import {
  projectBiblePassage,
  type RenderableBiblePassage,
} from "../lib/biblePassages"
import { formatCitationLabel } from "../lib/citationFormat"
import { datadogLog } from "../lib/datadog"
import type { WatchBibleCitation } from "../lib/normalizeVideo"
import { GET_VIDEO_BIBLE_PASSAGES } from "../lib/queries"
import { withTimeout } from "../lib/withTimeout"

const JOIN_BIBLE_STUDY_URL =
  "https://join.bsfinternational.org/?utm_source=jesusfilm-watch"
const PROMO_IMAGE_URL =
  "https://images.unsplash.com/photo-1650658720644-e1588bd66de3?w=900&auto=format&fit=crop&q=60"

const BIBLE_IMAGES = [
  "https://images.unsplash.com/photo-1480869799327-03916a613b29?q=80&w=800&auto=format&fit=crop",
  "https://images.unsplash.com/16/unsplash_526360a842e20_1.JPG?q=80&w=800&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1497333558196-daaff02b56d0?q=80&w=800&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1555892727-55b51e5fceae?q=80&w=800&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1631125915973-e0d155a14e4e?q=80&w=800&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1659260145900-1ac1afc45dcf?q=80&w=800&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1535979863199-3c77338429a0?q=80&w=800&auto=format&fit=crop",
] as const

/**
 * KTD3. Admin's provider call carries no timeout, so isolation alone bounds the
 * blast radius but not the duration. Must stay strictly below the client's own
 * `REQUEST_TIMEOUT_MS` or it is inert; matches `EXPERIENCE_FETCH_DEADLINE_MS`,
 * whose posture is the same — an additive read that must not hold a required
 * load hostage. Since the carousel reserves its height, this bounds how long
 * the loading state runs, not whether content jumps.
 */
export const PASSAGE_FETCH_DEADLINE_MS = 8000

export type BibleQuoteBlock = {
  reference: string
  text: string
  attribution: string | null
  imageUrl: string | null
  backgroundColor: string | null
  ctaLabel: string | null
  ctaLink: string | null
  /** Passage-only. Absent on the Experience and SDUI paths, which are unchanged. */
  translation: string | null
  copyright: string | null
  passageUrl: string | null
  /** The read has not settled: reserve the card's height, show no verse yet. */
  loading: boolean
}

export type BibleQuotesState = {
  cards: BibleQuoteBlock[]
  /** True until the passage read settles, on every path including failure. */
  loading: boolean
}

type PassageMap = ReadonlyMap<string, RenderableBiblePassage>

const NO_PASSAGES: PassageMap = new Map()

type ReadState =
  | { status: "idle" }
  | { status: "unsettled" }
  | { status: "settled"; passages: PassageMap }

const IDLE: ReadState = { status: "idle" }
const UNSETTLED: ReadState = { status: "unsettled" }
const SETTLED_EMPTY: ReadState = { status: "settled", passages: NO_PASSAGES }

type RawCitationRow = {
  documentId?: string | null
  passage?: Parameters<typeof projectBiblePassage>[0]
}

/**
 * Project the response into a passage map, logging each degraded path under its
 * own reason. The three stay distinguishable on purpose: `no_passage` is a
 * designed outcome, `gate_rejected` is the signal that an upstream change
 * started suppressing verses, and they must not read the same in Datadog.
 */
function collectPassages(rows: readonly RawCitationRow[], slug: string) {
  const passages = new Map<string, RenderableBiblePassage>()
  let absent = 0

  for (const row of rows) {
    const documentId = row.documentId
    if (documentId == null || documentId === "") continue

    const projection = projectBiblePassage(row.passage)
    if (projection.status === "renderable") {
      passages.set(documentId, projection.passage)
      continue
    }
    if (projection.status === "rejected") {
      datadogLog.warn("bible_passages.degraded", {
        reason: "gate_rejected",
        missing_field: projection.missingField,
        slug,
      })
      continue
    }
    absent += 1
  }

  if (absent > 0) {
    datadogLog.info("bible_passages.degraded", {
      reason: "no_passage",
      slug,
      citation_count: absent,
    })
  }

  return passages
}

/**
 * Resolve admin's Bible passages for a video's citations and compose the
 * carousel's cards.
 *
 * The read is a COMPANION to the query that gates the player, never part of it
 * (KTD1), so a slow or failed passage never delays playback. It is keyed on the
 * route slug rather than on the citations array, which republishes at least
 * twice per open, and on whether any citation exists at all.
 */
export function useBibleVerses(
  slug: string,
  citations: WatchBibleCitation[],
): BibleQuotesState {
  const [read, setRead] = useState<ReadState>(IDLE)
  // A superseded video's response must never land on the new one's cards.
  const requestIdRef = useRef(0)
  const hasCitations = citations.length > 0

  useEffect(() => {
    const thisRequest = ++requestIdRef.current

    // R12: a video with no citations makes no request.
    if (!slug || !hasCitations) {
      setRead(IDLE)
      return
    }

    // A failed read is not cached, so without this every re-entry repeats it
    // under the same stall. Settle immediately into reference-only cards.
    if (isPassageReadSuppressed(slug, Date.now())) {
      setRead(SETTLED_EMPTY)
      return
    }

    setRead(UNSETTLED)

    // Leaving the screen must not leave the deadline timer armed, and must not
    // look like a failed read — only a real rejection or overrun opens a
    // cooldown window.
    const controller = new AbortController()

    void (async () => {
      // allSettled + withTimeout: a rejection or an overrun degrades the
      // carousel, and neither can reach the caller as an unhandled rejection.
      const [outcome] = await Promise.allSettled([
        withTimeout(
          getApolloClient().query({
            query: GET_VIDEO_BIBLE_PASSAGES,
            variables: { slug },
            fetchPolicy: "cache-first",
          }),
          PASSAGE_FETCH_DEADLINE_MS,
          controller.signal,
        ),
      ])

      if (controller.signal.aborted) return

      // Cooldown bookkeeping is module-global: run it even for a superseded
      // response, which the guard below only stops from reaching state.
      if (outcome?.status === "fulfilled") clearPassageReadCooldown(slug)
      else registerPassageReadFailure(slug, Date.now())

      if (requestIdRef.current !== thisRequest) return

      if (outcome?.status !== "fulfilled") {
        datadogLog.warn("bible_passages.degraded", {
          reason: "read_failed",
          slug,
        })
        setRead(SETTLED_EMPTY)
        return
      }

      const rows = outcome.value?.data?.videoBySlug?.bibleCitations ?? []
      setRead({
        status: "settled",
        passages: collectPassages(rows, slug),
      })
    })()

    // Retires the in-flight read. Setup always mints a fresh id and a fresh
    // controller above, so a StrictMode setup → cleanup → setup cycle re-arms
    // rather than wedging.
    return () => {
      requestIdRef.current += 1
      controller.abort()
    }
  }, [slug, hasCitations])

  const loading = read.status === "unsettled"
  const passages = read.status === "settled" ? read.passages : NO_PASSAGES

  return useMemo(() => {
    const cards: BibleQuoteBlock[] = citations.map((citation, index) => {
      const passage = passages.get(citation.documentId)
      return {
        // R10: a citation with no renderable passage keeps its own reference.
        reference: passage?.reference ?? formatCitationLabel(citation),
        text: passage?.content ?? "",
        attribution: null,
        imageUrl: BIBLE_IMAGES[index % BIBLE_IMAGES.length] ?? null,
        backgroundColor: null,
        ctaLabel: null,
        ctaLink: null,
        translation: passage?.versionTitle ?? null,
        copyright: passage?.copyright ?? null,
        passageUrl: passage?.passageUrl ?? null,
        loading,
      }
    })

    cards.push({
      reference: "FREE RESOURCES",
      text: "Want to explore life's biggest questions?",
      attribution: null,
      imageUrl: PROMO_IMAGE_URL,
      backgroundColor: null,
      ctaLabel: "Join Our Bible Study",
      ctaLink: JOIN_BIBLE_STUDY_URL,
      translation: null,
      copyright: null,
      passageUrl: null,
      loading: false,
    })

    return { cards, loading }
  }, [citations, passages, loading])
}
