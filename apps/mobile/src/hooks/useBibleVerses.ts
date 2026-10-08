import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

import type { AdminLanguageForms } from "../i18n/adminLanguage"
import { useT } from "../i18n/useT"
import { getApolloClient } from "../lib/apolloClient"
import type { ReadingPositionSnapshot } from "../lib/bible/position/store"
import { isBsbVerseRef } from "../lib/bible/position/snapshot"
import {
  cardQuoteKey,
  resolveCardQuotes,
  type CardQuote,
  type CardQuoteFallbackReason,
  type CardQuoteServices,
} from "../lib/bible/quotes/cardQuote"
import { getCardQuoteServices } from "../lib/bible/quotes/services"
import type { TextDirection } from "../lib/bible/text/types"
import type { VerseRef } from "../lib/bible/versification/convert"
import { deriveBibleCardArt, type BibleCardArt } from "../lib/bibleCardArt"
import {
  clearPassageReadCooldown,
  isPassageReadSuppressed,
  registerPassageReadFailure,
} from "../lib/biblePassageCooldown"
import {
  projectBiblePassage,
  type BiblePassageProjection,
  type RenderableBiblePassage,
} from "../lib/biblePassages"
import { formatCitationLabel } from "../lib/citationFormat"
import { datadogLog } from "../lib/datadog"
import type { WatchBibleCitation, WatchVariant } from "../lib/normalizeVideo"
import {
  GET_VIDEO_BIBLE_PASSAGES,
  type VideoBiblePassagesData,
} from "../lib/queries"
import {
  ENGLISH_TEXT_LANG,
  ENGLISH_TEXT_SLUG,
  textLangFor,
  videoTextVariables,
} from "../lib/videoText"
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
  /** The film's own language, matched EXACTLY by the dub pin. */
  primaryLanguageCoreId: string | null
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
  /** The language of the verse, translation, and copyright: the UI's, or `en`
   *  for the English passage (R10). Null when the card shows no passage. */
  textLang: string | null
  /** A card from the reader's translation: the catalog's direction for the
   *  verse, reference, and name (KTD7). Null on admin's cards. */
  verseDirection: TextDirection | null
  /** A card from the reader's translation: its BCP-47 tag, for the screen
   *  reader and the reference's upper case (KTD7). Null on admin's cards. */
  verseLang: string | null
  /** Where "Read full passage" opens the reader, in BSB numbering (KTD17).
   *  Named like `artCandidates`. Null shows no button, whatever the passage. */
  citationStart: VerseRef | null
  /** The read has not settled: reserve the card's height, show no verse yet. */
  loading: boolean
}

// R1: a citation with no verse opens verse 1. A verse that BSB does not have
// opens verse 1 too, because the reader would open the saved place instead.
// A chapter that BSB does not have gives no start.
export function citationReaderStart(
  citation: Pick<
    WatchBibleCitation,
    "bookUsfm" | "chapterStart" | "verseStart"
  >,
): VerseRef | null {
  const { bookUsfm: book, chapterStart: chapter } = citation
  if (book == null || chapter == null) return null
  const cited = { book, chapter, verse: citation.verseStart ?? 1 }
  if (isBsbVerseRef(cited)) return cited
  const chapterOpening = { book, chapter, verse: 1 }
  return isBsbVerseRef(chapterOpening) ? chapterOpening : null
}

export type BibleQuotesState = {
  cards: BibleQuoteBlock[]
  /** True while any card waits for its source, on every path including
   *  failure: the passage read, or the reader translation's read. */
  loading: boolean
  /**
   * A card's artwork failed; advance it one rung. Owned HERE, not in the card:
   * the carousel unmounts off-window cells, so card-local state would reset on
   * scroll-back and re-request the URL that just failed, every time.
   */
  reportArtworkFailure: (cardIndex: number, failedUrl: string) => void
}

type PassageEntry = { passage: RenderableBiblePassage; lang: string }

type PassageMap = ReadonlyMap<string, PassageEntry>

const NO_PASSAGES: PassageMap = new Map()

/** Stable identity so re-arming the per-video reset cannot loop a re-render. */
const NO_ART_FAILURES: Record<string, true> = {}

/** What a video with no Bible block resolves to, without pinning a dub. */
const NO_CARD_ART = {
  candidates: [] as string[][],
  tier: "none",
  hasPlaybackId: false,
} as const satisfies BibleCardArt

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

/** The language the passage read asks in, taken from the route's forms. */
type PassageLanguage = { textSlug: string; lang: string }

function passageLanguage(forms: AdminLanguageForms): PassageLanguage {
  return {
    textSlug: videoTextVariables(forms).textSlug,
    lang: textLangFor(forms),
  }
}

/** The companion's variables. An English UI skips the duplicate English read. */
export function biblePassageVariables(
  slug: string,
  textSlug: string,
): { slug: string; textSlug: string; isEnglish: boolean } {
  return { slug, textSlug, isEnglish: textSlug === ENGLISH_TEXT_SLUG }
}

function englishPassageOf(row: RawCitationRow) {
  return "englishPassage" in row ? row.englishPassage : null
}

/** R9, R10: the passage for the route's slug, else the English one. Admin
 *  answers a slug it cannot map with its English version, so a passage with the
 *  English passage's version id is English text. */
function choosePassage(
  row: RawCitationRow,
  local: BiblePassageProjection,
  english: BiblePassageProjection,
  language: PassageLanguage,
): PassageEntry | null {
  if (local.status === "renderable") {
    // The gate passed both, so each version id is a positive integer.
    const sameAsEnglish =
      english.status === "renderable" &&
      englishPassageOf(row)?.versionId === row.passage?.versionId
    const englishText = language.textSlug === ENGLISH_TEXT_SLUG || sameAsEnglish
    return {
      passage: local.passage,
      lang: englishText ? ENGLISH_TEXT_LANG : language.lang,
    }
  }
  return english.status === "renderable"
    ? { passage: english.passage, lang: ENGLISH_TEXT_LANG }
    : null
}

/**
 * Project the response into a passage map, logging each degraded path under its
 * own reason. The three stay distinguishable on purpose: `no_passage` is a
 * designed outcome, `gate_rejected` is the signal that an upstream change
 * started suppressing verses, and they must not read the same in Datadog.
 */
function collectPassages(
  rows: readonly RawCitationRow[],
  slug: string,
  language: PassageLanguage,
) {
  const passages = new Map<string, PassageEntry>()
  let absent = 0

  for (const row of rows) {
    const documentId = row.documentId
    if (documentId == null || documentId === "") continue

    const projection = projectBiblePassage(row.passage)
    const english = projectBiblePassage(englishPassageOf(row))
    const chosen = choosePassage(row, projection, english, language)
    if (chosen != null) {
      passages.set(documentId, chosen)
      continue
    }
    const rejected = [projection, english].find(
      (p): p is Extract<BiblePassageProjection, { status: "rejected" }> =>
        p.status === "rejected",
    )
    if (rejected != null) {
      datadogLog.warn("bible_passages.degraded", {
        reason: "gate_rejected",
        missing_field: rejected.missingField,
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
function readCachedPassages(
  slug: string,
  language: PassageLanguage,
): ReadState {
  try {
    const cached = getApolloClient().readQuery({
      query: GET_VIDEO_BIBLE_PASSAGES,
      variables: biblePassageVariables(slug, language.textSlug),
    })
    const rows = cached?.videoBySlug?.bibleCitations
    if (rows == null) return SETTLED_EMPTY
    return {
      status: "settled",
      passages: collectPassages(rows, slug, language),
    }
  } catch {
    // A cache miss on an incomplete entry reads as no passages, never a throw.
    return SETTLED_EMPTY
  }
}

// ── Cards from the reader's translation (plan 2026-10-08) ─────────────────

/** The reader translation's inputs, threaded in by the watch route (KTD3). */
export type ReaderTranslationInputs = {
  /** `WatchPreferences.audioLanguageIso3`. */
  audioLanguage: string | null
  /** False until the watch preferences are read. */
  audioReady: boolean
  /** Each return to the screen resolves the cards again (KTD11). */
  focused: boolean
}

/** A card's source on this open: its reader translation, and the verse from
 *  that translation, or null for admin's card. */
type SettledCard = { translationId: string | null; quote: CardQuote | null }

type ReaderCards = {
  slug: string
  settled: ReadonlyMap<string, SettledCard>
  /** Cards whose new reader translation is loading (KTD11). */
  reloading: ReadonlySet<string>
}

const NO_SETTLED: ReadonlyMap<string, SettledCard> = new Map()
const NO_RELOADING: ReadonlySet<string> = new Set()
const NO_READER_CARDS: ReaderCards = {
  slug: "",
  settled: NO_SETTLED,
  reloading: NO_RELOADING,
}

/** What the card run needs from admin's read (KTD4, KTD5). */
type AdminOutcome = {
  passages: PassageMap
  /** False on the cooldown path, which reads only the device. */
  network: boolean
}

/** One admin read. `outcome` never rejects, and an abort leaves it pending. */
type AdminRead = {
  startedAt: number
  settled: boolean
  outcome: Promise<AdminOutcome>
  settle: (outcome: AdminOutcome) => void
}

function startAdminRead(): AdminRead {
  let resolve: (outcome: AdminOutcome) => void = () => {}
  const read: AdminRead = {
    startedAt: Date.now(),
    settled: false,
    outcome: new Promise<AdminOutcome>((settle) => {
      resolve = settle
    }),
    settle(outcome) {
      read.settled = true
      resolve(outcome)
    },
  }
  return read
}

/** Why a card that could have shown its reader translation shows admin's. */
type SettleReason = CardQuoteFallbackReason | "timeout" | "no-network"

type RunResult = {
  settled: Map<string, SettledCard>
  local: number
  admin: number
  fallbacks: Record<SettleReason, number>
}

function emptyRun(): RunResult {
  return {
    settled: new Map(),
    local: 0,
    admin: 0,
    fallbacks: {
      "unknown-translation": 0,
      "no-verse": 0,
      "too-long": 0,
      "read-failed": 0,
      error: 0,
      timeout: 0,
      "no-network": 0,
    },
  }
}

type RunInput = {
  services: CardQuoteServices
  citations: readonly WatchBibleCitation[]
  audioLanguage: string | null
  payloadSettled: boolean
  admin: AdminRead
  /** The cards this open already settled, by `cardQuoteKey`. */
  previous: ReadonlyMap<string, SettledCard>
  signal: AbortSignal
  onReloading: (keys: ReadonlySet<string>) => void
}

/** The value, or null once the time is up or the run is left. */
function within<T>(
  promise: Promise<T>,
  ms: number,
  signal: AbortSignal,
): Promise<T | null> {
  return withTimeout(promise, Math.max(ms, 0), signal).catch(() => null)
}

/**
 * One pass over the cards: each card not yet settled, and each settled gap
 * card whose reader translation changed (KTD11), gets its final source. Null
 * when the run was left. Device reads run beside admin's read; a network read
 * waits for it and runs only for a gap card (R1, KTD4).
 */
async function runReaderCards(input: RunInput): Promise<RunResult | null> {
  const { services, citations, audioLanguage, admin, previous, signal } = input
  const result = emptyRun()
  const settle = (
    key: string,
    card: SettledCard,
    reason: SettleReason | "admin" | "local",
  ) => {
    result.settled.set(key, card)
    if (reason === "local") result.local += 1
    else if (reason === "admin") result.admin += 1
    else result.fallbacks[reason] += 1
  }
  const settleNew = (reason: SettleReason) => {
    for (const citation of citations) {
      const key = cardQuoteKey(citation)
      if (!previous.has(key))
        settle(key, { translationId: null, quote: null }, reason)
    }
  }

  try {
    // KTD4: the open's one budget, shared with admin's read. A run after admin
    // settled (a return, a new pick) gets its own (KTD11).
    const deadline =
      (admin.settled ? Date.now() : admin.startedAt) + PASSAGE_FETCH_DEADLINE_MS
    const left = () => deadline - Date.now()
    const device = await within(
      resolveCardQuotes(services, {
        citations,
        audioLanguage,
        reach: "device",
      }),
      left(),
      signal,
    )
    const adminOutcome = await within(admin.outcome, left(), signal)
    if (signal.aborted) return null
    if (device == null || adminOutcome == null) {
      settleNew("timeout")
      return result
    }

    const network: {
      citation: WatchBibleCitation
      translationId: string | null
    }[] = []
    for (const citation of citations) {
      const key = cardQuoteKey(citation)
      const found = device.get(key)
      if (found == null || found.status === "pending") {
        // KTD9: a book still unknown waits for the payload.
        if (input.payloadSettled && !previous.has(key)) {
          settle(key, { translationId: null, quote: null }, "no-verse")
        }
        continue
      }
      const { translationId } = found
      const entry = adminOutcome.passages.get(citation.documentId)
      const gap = entry == null || entry.lang === ENGLISH_TEXT_LANG
      const known = previous.get(key)
      if (known && (!gap || known.translationId === translationId)) continue
      const adminCard = { translationId, quote: null }
      if (!gap || found.status === "admin") settle(key, adminCard, "admin")
      else if (found.status === "local") {
        settle(key, { translationId, quote: found.quote }, "local")
      } else if (found.status === "fallback") {
        settle(key, adminCard, found.reason)
      } else if (adminOutcome.network) {
        network.push({ citation, translationId })
      } else settle(key, adminCard, "no-network")
    }
    if (network.length === 0) return result

    const reloading = new Set(
      network
        .map(({ citation }) => cardQuoteKey(citation))
        .filter((key) => previous.has(key)),
    )
    if (reloading.size > 0) input.onReloading(reloading)
    const read = await within(
      resolveCardQuotes(services, {
        citations: network.map(({ citation }) => citation),
        audioLanguage,
        reach: "network",
      }),
      left(),
      signal,
    )
    if (signal.aborted) return null
    for (const { citation, translationId } of network) {
      const key = cardQuoteKey(citation)
      const found = read?.get(key)
      const adminCard = { translationId, quote: null }
      if (found == null) settle(key, adminCard, "timeout")
      else if (found.status === "local") {
        settle(key, { translationId, quote: found.quote }, "local")
      } else if (found.status === "fallback") {
        settle(key, adminCard, found.reason)
      } else if (found.status === "admin") settle(key, adminCard, "admin")
      else settle(key, adminCard, "read-failed")
    }
    return result
  } catch {
    // Every card that has no source yet gets admin's, or it would load forever.
    if (signal.aborted) return null
    settleNew("error")
    return result
  }
}

/** The viewer's pick, the one part of the reading position a card reads. */
function readerPickKey(position: ReadingPositionSnapshot): string {
  return `${position.translationId ?? ""}|${position.sessionTranslationId ?? ""}`
}

/**
 * Resolve admin's Bible passages for a video's citations and compose the
 * carousel's cards.
 *
 * The read is a COMPANION to the query that gates the player, never part of it
 * (KTD1), so a slow or failed passage never delays playback. It is keyed on the
 * route slug rather than on the citations array, which republishes at least
 * twice per open, and on whether any citation exists at all.
 *
 * Where admin's passage would be English, a card shows the verse from the
 * viewer's Bible reader translation instead (plan 2026-10-08, R1).
 */
export function useBibleVerses(
  slug: string,
  citations: WatchBibleCitation[],
  art: BibleCardArtSource,
  /** The route's captured forms (KTD16); never the store's. */
  forms: AdminLanguageForms,
  reader: ReaderTranslationInputs,
): BibleQuotesState {
  const t = useT("BibleQuotes")
  const [read, setRead] = useState<ReadState>(IDLE)
  // A superseded video's response must never land on the new one's cards.
  const requestIdRef = useRef(0)
  // The latest admin read, for the card run that starts in the same commit.
  const adminRef = useRef<AdminRead | null>(null)
  const hasCitations = citations.length > 0

  const { variants, authoredImageUrl, primaryLanguageCoreId, payloadSettled } =
    art
  const { textSlug, lang: uiLang } = passageLanguage(forms)

  useEffect(() => {
    const thisRequest = ++requestIdRef.current
    const language: PassageLanguage = { textSlug, lang: uiLang }

    // R12: a video with no citations makes no request.
    if (!slug || !hasCitations) {
      adminRef.current = null
      setRead(IDLE)
      return
    }
    const admin = startAdminRead()
    adminRef.current = admin

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
      const cached = readCachedPassages(slug, language)
      setRead(cached)
      admin.settle({
        passages: cached.status === "settled" ? cached.passages : NO_PASSAGES,
        network: false,
      })
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
      admin.settle({ passages: NO_PASSAGES, network: true })
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
              variables: biblePassageVariables(slug, textSlug),
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
      const passages = collectPassages(rows, slug, language)
      setRead({ status: "settled", passages })
      admin.settle({ passages, network: true })
    })()

    // Retires the in-flight read. Setup always mints a fresh id and a fresh
    // controller above, so a StrictMode setup → cleanup → setup cycle re-arms
    // rather than wedging.
    return () => {
      requestIdRef.current += 1
      controller.abort()
    }
  }, [slug, hasCitations, textSlug, uiLang])

  // ── Cards from the reader's translation (plan 2026-10-08, KTD3, KTD11) ──
  const [quoteServices] = useState(getCardQuoteServices)
  const { positionStore } = quoteServices
  const pickKey = useSyncExternalStore(
    positionStore.subscribe,
    () => readerPickKey(positionStore.getSnapshot()),
    () => "",
  )
  // Each return to the screen starts a new epoch, and so a new run.
  const [focus, setFocus] = useState({ focused: reader.focused, epoch: 0 })
  if (focus.focused !== reader.focused) {
    setFocus({
      focused: reader.focused,
      epoch: reader.focused ? focus.epoch + 1 : focus.epoch,
    })
  }
  const { audioLanguage, audioReady } = reader
  const [readerCards, setReaderCards] = useState<ReaderCards>(NO_READER_CARDS)
  // Every input of a run, so the effect below starts one per change. It names
  // the passage read's inputs too, so both effects re-run in one commit.
  const runKey = [
    slug,
    textSlug,
    uiLang,
    citations.map(cardQuoteKey).join("~"),
    payloadSettled,
    audioLanguage ?? "",
    pickKey,
    focus.epoch,
  ].join("¦")

  useEffect(() => {
    const admin = adminRef.current
    if (!slug || !hasCitations || !audioReady || admin == null) return
    const controller = new AbortController()
    const { signal } = controller
    void runReaderCards({
      services: quoteServices,
      citations,
      audioLanguage,
      payloadSettled,
      admin,
      previous: readerCards.slug === slug ? readerCards.settled : NO_SETTLED,
      signal,
      onReloading(keys) {
        if (signal.aborted) return
        setReaderCards((current) =>
          current.slug === slug
            ? {
                ...current,
                reloading: new Set([...current.reloading, ...keys]),
              }
            : current,
        )
      },
    }).then((result) => {
      if (result == null || signal.aborted) return
      // A run settles every card that needed a source, so none still reloads.
      setReaderCards((current) =>
        result.settled.size === 0 &&
        current.slug === slug &&
        current.reloading.size === 0
          ? current
          : {
              slug,
              settled: new Map([
                ...(current.slug === slug ? current.settled : NO_SETTLED),
                ...result.settled,
              ]),
              reloading: NO_RELOADING,
            },
      )
      if (result.settled.size === 0) return
      // KTD10: one event per settle. The counts are inline, not in the message.
      datadogLog.info("bible_quotes.reader_translation", {
        slug,
        card_count: result.settled.size,
        local_count: result.local,
        admin_count: result.admin,
        fallback_unknown_translation: result.fallbacks["unknown-translation"],
        fallback_no_verse: result.fallbacks["no-verse"],
        fallback_too_long: result.fallbacks["too-long"],
        fallback_read_failed: result.fallbacks["read-failed"],
        fallback_error: result.fallbacks.error,
        fallback_timeout: result.fallbacks.timeout,
        fallback_no_network: result.fallbacks["no-network"],
      })
    })
    return () => controller.abort()
    // Keyed on runKey: it holds every input that changes a card's source.
  }, [runKey, audioReady])

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

  // Gated on `hasCitations`: the derivation sorts the video's WHOLE dub list to
  // pin one, and a video with no Bible block never reads the result. The JESUS
  // film carries 2,281 published dubs, so this ran on every watch-screen open.
  const cardArt = useMemo(
    () =>
      hasCitations
        ? deriveBibleCardArt({
            variants,
            authoredImageUrl,
            primaryLanguageCoreId,
            citations,
            stockImages: BIBLE_IMAGES,
            payloadSettled: payloadSettled || holdReleased,
          })
        : NO_CARD_ART,
    [
      hasCitations,
      variants,
      authoredImageUrl,
      primaryLanguageCoreId,
      citations,
      payloadSettled,
      holdReleased,
    ],
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
    // The REAL payload, not the hold's timed release: the released state
    // resolves to stock and then flips to the still, so logging it reports a
    // stock outcome for a video that ends on one — the alert's false positive.
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

  const passageLoading = read.status === "unsettled"
  const passages = read.status === "settled" ? read.passages : NO_PASSAGES
  const sources = readerCards.slug === slug ? readerCards : NO_READER_CARDS

  return useMemo(() => {
    const cards: BibleQuoteBlock[] = citations.map((citation, index) => {
      const entry = passages.get(citation.documentId)
      const passage = entry?.passage
      const artCandidates = cardArt.candidates[index] ?? []
      // The best rung this card has not already failed. Resolved by URL, so a
      // list that gains a higher tier after a republish is still tried.
      const firstUsable = artCandidates.findIndex(
        (url) => artFailures[`${slug}:${index}:${url}`] !== true,
      )
      const artIndex = firstUsable === -1 ? artCandidates.length : firstUsable
      const key = cardQuoteKey(citation)
      const source = sources.settled.get(key)
      // R12: a card shows nothing until both reads settle it.
      const loading =
        passageLoading || source == null || sources.reloading.has(key)
      const quote = loading ? null : (source?.quote ?? null)
      const art = {
        attribution: null,
        imageUrl: artCandidates[artIndex] ?? null,
        artCandidates,
        artIndex,
        backgroundColor: null,
        ctaLabel: null,
        ctaLink: null,
        citationStart: citationReaderStart(citation),
        loading,
      }
      if (quote) {
        return {
          ...art,
          reference: formatCitationLabel(quote.reference, t),
          text: quote.text,
          translation: quote.translationName,
          copyright: quote.credit,
          textLang: quote.languageTag,
          verseDirection: quote.textDirection,
          verseLang: quote.languageTag,
        }
      }
      return {
        ...art,
        // R10: a citation with no renderable passage keeps its own reference,
        // and so does a loading card, which may yet show another translation.
        reference:
          (loading ? null : passage?.reference) ??
          formatCitationLabel(citation, t),
        text: passage?.content ?? "",
        translation: passage?.versionTitle ?? null,
        copyright: passage?.copyright ?? null,
        textLang: entry?.lang ?? null,
        verseDirection: null,
        verseLang: null,
      }
    })
    const loading = cards.some((card) => card.loading)

    // Built AFTER the citation map, never inside it: that is what keeps the
    // promotional card out of the ladder, rather than an index check a later
    // edit could break. Its empty candidate list is the second belt.
    cards.push({
      reference: t("promoEyebrow"),
      text: t("promoText"),
      attribution: null,
      imageUrl: PROMO_IMAGE_URL,
      artCandidates: [],
      artIndex: 0,
      backgroundColor: null,
      ctaLabel: t("joinBibleStudy"),
      ctaLink: JOIN_BIBLE_STUDY_URL,
      translation: null,
      copyright: null,
      textLang: null,
      verseDirection: null,
      verseLang: null,
      citationStart: null,
      loading: false,
    })

    return { cards, loading, reportArtworkFailure }
  }, [
    citations,
    passages,
    passageLoading,
    sources,
    cardArt,
    artFailures,
    slug,
    reportArtworkFailure,
    t,
  ])
}
