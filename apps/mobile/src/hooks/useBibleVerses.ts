import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { getApolloClient } from "../lib/apolloClient"
import { deriveBibleCardArt } from "../lib/bibleCardArt"
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
import type { WatchBibleCitation, WatchVariant } from "../lib/normalizeVideo"
import {
  GET_VIDEO_BIBLE_PASSAGES,
  type VideoBiblePassagesData,
} from "../lib/queries"
import { withTimeout } from "../lib/withTimeout"

const JOIN_BIBLE_STUDY_URL =
  "https://join.bsfinternational.org/?utm_source=jesusfilm-watch"
const PROMO_IMAGE_URL =
  "https://images.unsplash.com/photo-1650658720644-e1588bd66de3?w=900&auto=format&fit=crop&q=60"

/**
 * The ladder's LAST rung, not the source of card art. Keeps a video with
 * neither a still nor authored art from rendering bare. Do not delete, and do
 * not sync to `apps/tv`, which still cycles its own copy per citation.
 */
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

/**
 * The artwork hold's own release. A payload that never settles must not strand
 * every card at its background colour for the session.
 */
export const ART_HOLD_RELEASE_MS = 8000

/** What the derivation needs from the video, threaded in by the watch route. */
export type BibleCardArtSource = {
  variants: readonly WatchVariant[]
  /** The video's own resolved card art, the ladder's middle rung. */
  authoredImageUrl: string | null
  /** False while the watch query is still filling in from partial cached data. */
  payloadSettled: boolean
}

export type BibleQuoteBlock = {
  reference: string
  text: string
  attribution: string | null
  imageUrl: string | null
  /**
   * Every validated tier for this card, best first. NAMED, not a passenger on
   * the untyped block bag: the two sides meet through an index signature, so a
   * field added on one alone typechecks clean and silently renders nothing.
   */
  artCandidates: string[]
  /** Which candidate `imageUrl` came from; the index a load failure reports. */
  artIndex: number
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
  /**
   * A card's artwork failed; advance it one rung. Owned HERE, not in the card:
   * the carousel unmounts off-window cells, so card-local state would reset on
   * scroll-back and re-request the URL that just failed, every time.
   */
  reportArtworkFailure: (cardIndex: number, failedUrl: string) => void
}

type PassageMap = ReadonlyMap<string, RenderableBiblePassage>

const NO_PASSAGES: PassageMap = new Map()

/** Stable identity so re-arming the per-video reset cannot loop a re-render. */
const NO_ART_FAILURES: Record<string, true> = {}

type ReadState =
  | { status: "idle" }
  | { status: "unsettled" }
  | { status: "settled"; passages: PassageMap }

const IDLE: ReadState = { status: "idle" }
const UNSETTLED: ReadState = { status: "unsettled" }
const SETTLED_EMPTY: ReadState = { status: "settled", passages: NO_PASSAGES }

type PassageQueryResult = { data?: VideoBiblePassagesData | null }

type RawCitationRow = NonNullable<
  NonNullable<VideoBiblePassagesData["videoBySlug"]>["bibleCitations"]
>[number]

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
 * Read whatever this slug's passages are already in the cache, without touching
 * the network. Used while the failure cooldown is open: the cooldown guards
 * against repeating a stall, and a cache read cannot stall.
 */
function readCachedPassages(slug: string): ReadState {
  try {
    const cached = getApolloClient().readQuery({
      query: GET_VIDEO_BIBLE_PASSAGES,
      variables: { slug },
    })
    const rows = cached?.videoBySlug?.bibleCitations
    if (rows == null) return SETTLED_EMPTY
    return { status: "settled", passages: collectPassages(rows, slug) }
  } catch {
    // A cache miss on an incomplete entry reads as no passages, never a throw.
    return SETTLED_EMPTY
  }
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
  art: BibleCardArtSource,
): BibleQuotesState {
  const [read, setRead] = useState<ReadState>(IDLE)
  // A superseded video's response must never land on the new one's cards.
  const requestIdRef = useRef(0)
  const hasCitations = citations.length > 0

  const { variants, authoredImageUrl, payloadSettled } = art

  useEffect(() => {
    const thisRequest = ++requestIdRef.current

    // R12: a video with no citations makes no request.
    if (!slug || !hasCitations) {
      setRead(IDLE)
      return
    }

    // Suppress the NETWORK, never the cache. `withTimeout` only abandons the
    // wait — it cannot cancel the Apollo request, so a read that overruns the
    // deadline still lands under the client's own ceiling and normalizes into
    // the cache. Skipping the whole read would then withhold a passage that is
    // already in memory, for up to the full backoff window.
    if (isPassageReadSuppressed(slug, Date.now())) {
      datadogLog.info("bible_passages.degraded", {
        reason: "cooldown_suppressed",
        slug,
      })
      setRead(readCachedPassages(slug))
      return
    }

    setRead(UNSETTLED)

    // Leaving the screen must not leave the deadline timer armed, and must not
    // look like a failed read — only a real rejection or overrun opens a
    // cooldown window.
    const controller = new AbortController()

    const degrade = () => {
      registerPassageReadFailure(slug, Date.now())
      if (requestIdRef.current !== thisRequest) return
      datadogLog.warn("bible_passages.degraded", {
        reason: "read_failed",
        slug,
      })
      setRead(SETTLED_EMPTY)
    }

    void (async () => {
      let outcome: PromiseSettledResult<PassageQueryResult> | undefined
      try {
        // allSettled + withTimeout: a rejection or an overrun degrades the
        // carousel, and neither can reach the caller as an unhandled rejection.
        // The try/catch is for a SYNCHRONOUS throw out of `query()` — it would
        // skip withTimeout entirely and leave the carousel shimmering forever.
        ;[outcome] = await Promise.allSettled([
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
      } catch {
        if (!controller.signal.aborted) degrade()
        return
      }

      // An abort is this hook leaving, not a failed read: it must not open a
      // cooldown window. Every supersession path aborts, so no superseded
      // response reaches the bookkeeping below.
      if (controller.signal.aborted) return

      if (outcome?.status !== "fulfilled") {
        degrade()
        return
      }

      clearPassageReadCooldown(slug)
      if (requestIdRef.current !== thisRequest) return

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

  // The hold's own release. Re-armed per video, and cleared on the way out so
  // a StrictMode setup -> cleanup -> setup cycle re-arms rather than firing the
  // previous video's timer against this one.
  const [holdReleased, setHoldReleased] = useState(false)
  useEffect(() => {
    setHoldReleased(false)
    // Memory hygiene, not behaviour — the keys are already slug-scoped. Up
    // Next replaces the route params rather than remounting, so without this
    // the map grows for every video watched in the session.
    setArtFailures(NO_ART_FAILURES)
    const timer = setTimeout(() => setHoldReleased(true), ART_HOLD_RELEASE_MS)
    return () => clearTimeout(timer)
  }, [slug])

  const cardArt = useMemo(
    () =>
      deriveBibleCardArt({
        variants,
        authoredImageUrl,
        citations,
        stockImages: BIBLE_IMAGES,
        payloadSettled: payloadSettled || holdReleased,
      }),
    [variants, authoredImageUrl, citations, payloadSettled, holdReleased],
  )

  // Keyed by video AND citation position so an advance survives the cell
  // unmounting; the keys are slug-scoped so one video's failures cannot move
  // another video's cards.
  const [artFailures, setArtFailures] =
    useState<Record<string, true>>(NO_ART_FAILURES)
  const reportArtworkFailure = useCallback(
    (cardIndex: number, failedUrl: string) => {
      setArtFailures((prev) => {
        // Keyed by the URL that failed, not by its POSITION. A held card can
        // paint stock, fail, and only then receive the settled payload — which
        // prepends the still. A positional record would skip that new top rung.
        const key = `${slug}:${cardIndex}:${failedUrl}`
        if (prev[key]) return prev
        return { ...prev, [key]: true }
      })
    },
    [slug],
  )

  // One event per video per screen open — the derivation re-runs several times
  // and cannot emit this without weighting the signal by render count. Suppressed
  // while the payload holds, when the outcome is not yet a real one.
  const loggedSlugRef = useRef<string | null>(null)
  useEffect(() => {
    // Gated on the REAL payload, not the hold's timed release. Releasing early
    // resolves the ladder to stock and then flips to the still when the payload
    // lands — logging the released state would report a stock outcome for a
    // video that ends on a still, the alert's own false positive.
    if (!hasCitations || !payloadSettled) return
    if (loggedSlugRef.current === slug) return
    loggedSlugRef.current = slug
    datadogLog.info("bible_card_art.resolved", {
      tier: cardArt.tier,
      slug,
      citation_count: citations.length,
      has_playback_id: cardArt.hasPlaybackId,
    })
  }, [slug, hasCitations, payloadSettled, cardArt, citations.length])

  const loading = read.status === "unsettled"
  const passages = read.status === "settled" ? read.passages : NO_PASSAGES

  return useMemo(() => {
    const cards: BibleQuoteBlock[] = citations.map((citation, index) => {
      const passage = passages.get(citation.documentId)
      const artCandidates = cardArt.candidates[index] ?? []
      // The best rung this card has not already failed. Resolved by URL, so a
      // list that gains a higher tier after a republish is still tried.
      const firstUsable = artCandidates.findIndex(
        (url) => artFailures[`${slug}:${index}:${url}`] !== true,
      )
      const artIndex = firstUsable === -1 ? artCandidates.length : firstUsable
      return {
        // R10: a citation with no renderable passage keeps its own reference.
        reference: passage?.reference ?? formatCitationLabel(citation),
        text: passage?.content ?? "",
        attribution: null,
        imageUrl: artCandidates[artIndex] ?? null,
        artCandidates,
        artIndex,
        backgroundColor: null,
        ctaLabel: null,
        ctaLink: null,
        translation: passage?.versionTitle ?? null,
        copyright: passage?.copyright ?? null,
        passageUrl: passage?.passageUrl ?? null,
        loading,
      }
    })

    // Built AFTER the citation map, never inside it: that is what keeps the
    // promotional card out of the ladder, rather than an index check a later
    // edit could break. Its empty candidate list is the second belt.
    cards.push({
      reference: "FREE RESOURCES",
      text: "Want to explore life's biggest questions?",
      attribution: null,
      imageUrl: PROMO_IMAGE_URL,
      artCandidates: [],
      artIndex: 0,
      backgroundColor: null,
      ctaLabel: "Join Our Bible Study",
      ctaLink: JOIN_BIBLE_STUDY_URL,
      translation: null,
      copyright: null,
      passageUrl: null,
      loading: false,
    })

    return { cards, loading, reportArtworkFailure }
  }, [
    citations,
    passages,
    loading,
    cardArt,
    artFailures,
    slug,
    reportArtworkFailure,
  ])
}
