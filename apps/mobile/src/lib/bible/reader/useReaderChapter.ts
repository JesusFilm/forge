// The reader's chapter (feat-551 U7): the translation to show (U5), the verse
// in its own numbers (R38, R42), and the chapter from a per-screen view (U4).
// No effect keeps a ref that its cleanup changes, so StrictMode is safe.
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"

import type { Catalog, CatalogTranslation } from "../data/catalog"
import {
  chooseViewerTranslation,
  isNoNetworkFailure,
  resolveShownTranslation,
  type ShownTranslation,
} from "../language/defaultTranslation"
import { readerStartRef, type ReadingPositionSnapshot } from "../position/store"
import { chapterFailure, type ChapterFailureReason } from "../repository/errors"
import {
  toBsbRef,
  toTranslationRef,
  type ChapterRequest,
  type ChapterResolution,
  type ChapterSource,
} from "../repository/resolveChapter"
import { checkChapterNumbering, reportTranslationChanged } from "../telemetry"
import type { ChapterText } from "../text/types"
import { mappedLastVerse, type VerseRef } from "../versification/convert"
import { translationBookSystem } from "../versification/translationSystems.generated"
import type { ReaderServices } from "./services"
import { onDeviceSwitchTarget } from "./switchTarget"

type LoadedBase = {
  /** The reading position, in BSB numbering (R38). */
  ref: VerseRef
  shown: ShownTranslation
  /** The same verse in the shown translation's numbering (R42). */
  translationRef: VerseRef
  request: ChapterRequest
}

export type ReaderChapterState =
  /** The saved position, the audio language, or the catalog is not read yet. */
  | { status: "waiting" }
  | { status: "catalog-failed" }
  | (LoadedBase & { status: "loading" })
  | (LoadedBase & {
      status: "ready"
      text: ChapterText
      source: ChapterSource
      stale: boolean
    })
  | (LoadedBase & {
      status: "failed"
      reason: ChapterFailureReason
      /** R31's switch; null when no other translation has the book. */
      switchTarget: CatalogTranslation | null
    })

export type ReaderChapter = {
  state: ReaderChapterState
  catalog: Catalog | null
  /** True after a request in this visit got no network answer (R41). */
  offline: boolean
  retry(): void
  /** R31: show a translation on the device, for this session only. */
  switchToOnDevice(): void
  /** U8's moves: shows `target`, in the numbers of `translationId`, and saves
   *  it in BSB numbers (R38). A stop that BSB lacks still shows (R42). */
  goTo(target: VerseRef, translationId: string): void
}

export type ReaderChapterInput = {
  services: ReaderServices
  position: ReadingPositionSnapshot
  /** `WatchPreferences.audioLanguageIso3`. */
  audioLanguage: string | null
  /** False until the watch preferences are read. */
  audioReady: boolean
  /** Each focus is a reader open: it clears `offline` (AE16). */
  focused: boolean
}

type CatalogState =
  | { status: "loading" }
  | { status: "ok"; catalog: Catalog }
  | { status: "failed" }

type ShownState = {
  key: string
  choiceKey: string
  book: VerseRef["book"]
  shown: ShownTranslation | null
}

type ChapterState = { key: string; result: ChapterResolution }

/** A stop the store cannot hold, such as a Synodal Psalm title (R38, R42). */
type LocalStop = {
  translationId: string
  /** The stop, in that translation's numbers. */
  ref: VerseRef
  /** The store's BSB reference for it; any other value drops this stop. */
  anchor: VerseRef
}

function sameRef(a: VerseRef, b: VerseRef): boolean {
  return a.book === b.book && a.chapter === b.chapter && a.verse === b.verse
}

function requestKey(request: ChapterRequest, attempt: number): string {
  const { translationId, bookId, chapter, sha256 } = request
  return `${translationId}|${bookId}|${chapter}|${sha256}|${attempt}`
}

/** The next chapter in the same book, in the translation's own numbering. */
export function nextChapterRequest(
  request: ChapterRequest,
): ChapterRequest | null {
  const system = translationBookSystem(request.translationId, request.bookId)
  const next = request.chapter + 1
  return mappedLastVerse(system, request.bookId, next) === undefined
    ? null
    : { ...request, chapter: next }
}

export function useReaderChapter(input: ReaderChapterInput): ReaderChapter {
  const { services, position, audioLanguage, audioReady, focused } = input
  const { repository, downloads } = services

  const [view] = useState(() => repository.createView())
  const [phoneLanguage] = useState(() => services.readPhoneLanguage())
  const [offline, setOffline] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [catalogAttempt, setCatalogAttempt] = useState(0)
  const [catalogState, setCatalogState] = useState<CatalogState>({
    status: "loading",
  })
  const [shownState, setShownState] = useState<ShownState | null>(null)
  const [chapterState, setChapterState] = useState<ChapterState | null>(null)
  const [localStop, setLocalStop] = useState<LocalStop | null>(null)

  useEffect(() => {
    if (!focused) return
    setOffline(false)
    // A rejected check leaves every download reading as not downloaded.
    void Promise.resolve()
      .then(() => downloads.check())
      .catch(() => {})
  }, [focused, downloads])

  useEffect(() => {
    let active = true
    void services.loadCatalog().then((result) => {
      if (!active) return
      setCatalogState(
        result.status === "ok"
          ? { status: "ok", catalog: result.value }
          : { status: "failed" },
      )
    })
    return () => {
      active = false
    }
  }, [services, catalogAttempt])

  const catalog = catalogState.status === "ok" ? catalogState.catalog : null
  const ref = readerStartRef(position)
  const choice = {
    sessionTranslationId: position.sessionTranslationId,
    explicitTranslationId: position.translationId,
    audioLanguage,
    phoneLanguage,
  }
  const viewerId = catalog
    ? chooseViewerTranslation({ catalog, ...choice }).translationId
    : null
  // A finished download can change which books the viewer's translation has.
  const viewerDownload = useSyncExternalStore(
    downloads.subscribe,
    () => (viewerId ? downloads.getState(viewerId).kind : "none"),
    () => "none",
  )

  const choiceKey =
    catalog && ref && audioReady
      ? [
          choice.sessionTranslationId,
          choice.explicitTranslationId,
          audioLanguage,
          phoneLanguage,
          offline,
          viewerDownload,
          attempt,
        ].join("|")
      : null
  const shownKey =
    choiceKey && ref ? `${choiceKey}|${ref.book}|${ref.chapter}` : null

  useEffect(() => {
    if (!shownKey || !choiceKey || !catalog || !ref) return
    let active = true
    const book = ref.book
    void resolveShownTranslation({
      catalog,
      ...choice,
      ref,
      offline,
      isOnDevice: (request) => repository.isOnDevice(request),
      hasBook: (translation, bookId) =>
        repository.translationHasBook(translation, bookId),
    }).then(
      (shown) => {
        if (active) setShownState({ key: shownKey, choiceKey, book, shown })
      },
      () => {
        if (active)
          setShownState({ key: shownKey, choiceKey, book, shown: null })
      },
    )
    return () => {
      active = false
    }
    // Keyed on shownKey alone: it holds every input that changes the choice.
  }, [shownKey])

  // A move to another chapter of the same book keeps the last choice while
  // the new one resolves, so the verse area does not flash.
  const shownUsable =
    shownState !== null &&
    ref !== null &&
    (shownState.key === shownKey ||
      (shownState.choiceKey === choiceKey && shownState.book === ref.book))
  const shown = shownUsable ? shownState.shown : null

  const localUsable =
    localStop !== null &&
    shown !== null &&
    ref !== null &&
    localStop.translationId === shown.translation.id &&
    sameRef(localStop.anchor, ref)
  const translationRef =
    shown && ref
      ? localUsable
        ? localStop.ref
        : toTranslationRef(ref, shown.translation.id)
      : null
  const request: ChapterRequest | null =
    shown && ref && translationRef
      ? {
          translationId: shown.translation.id,
          bookId: ref.book,
          chapter: translationRef.chapter,
          sha256: shown.translation.sha256,
        }
      : null
  const loadKey = request ? requestKey(request, attempt) : null

  useEffect(() => {
    if (!request || !loadKey) return
    let active = true
    const apply = (result: ChapterResolution) => {
      if (!active) return
      setChapterState({ key: loadKey, result })
      if (result.status === "failed" && isNoNetworkFailure(result.reason)) {
        setOffline(true)
      }
      if (result.status === "ok") {
        // KTD6: once per chapter per process, so two hosts log it once.
        checkChapterNumbering(
          {
            translationId: request.translationId,
            bookId: request.bookId,
            chapter: request.chapter,
          },
          result.text.chapter.lastVerse,
        )
      }
      if (result.status === "ok" && result.source !== "bundled") {
        const next = nextChapterRequest(request)
        if (next) repository.prefetch(next)
      }
    }
    void view.show(request).then(
      (result) => {
        if (result.status !== "superseded") apply(result)
      },
      () => apply(chapterFailure("unavailable")),
    )
    return () => {
      active = false
    }
    // Keyed on loadKey alone: it names the request and the retry.
  }, [loadKey])

  const result =
    chapterState && chapterState.key === loadKey ? chapterState.result : null
  const failedTranslation =
    result?.status === "failed" && shown ? shown.translation : null
  const failedBook = ref?.book ?? null
  const switchTarget = useMemo(
    () =>
      catalog && failedTranslation && failedBook
        ? onDeviceSwitchTarget({
            catalog,
            failing: failedTranslation,
            bookId: failedBook,
            getState: (id) => downloads.getState(id),
          })
        : null,
    [catalog, failedTranslation, failedBook, downloads],
  )

  let state: ReaderChapterState
  if (
    catalogState.status === "failed" ||
    (shownUsable && shownState.shown === null)
  ) {
    state = { status: "catalog-failed" }
  } else if (!ref || !shown || !translationRef || !request) {
    state = { status: "waiting" }
  } else {
    const base: LoadedBase = { ref, shown, translationRef, request }
    if (!result) state = { ...base, status: "loading" }
    else if (result.status === "ok") {
      state = {
        ...base,
        status: "ready",
        text: result.text,
        source: result.source,
        stale: result.stale,
      }
    } else {
      state = { ...base, status: "failed", reason: result.reason, switchTarget }
    }
  }

  const catalogFailed = catalogState.status === "failed"
  const retry = useCallback(() => {
    if (catalogFailed) {
      setCatalogState({ status: "loading" })
      setCatalogAttempt((count) => count + 1)
      return
    }
    setOffline(false)
    setAttempt((count) => count + 1)
  }, [catalogFailed])

  const failedId = failedTranslation?.id ?? null
  const switchToOnDevice = useCallback(() => {
    if (
      switchTarget &&
      services.positionStore.switchTranslationForSession(switchTarget.id)
    ) {
      reportTranslationChanged("switched", failedId, switchTarget.id)
    }
  }, [services, switchTarget, failedId])

  const { positionStore } = services
  const goTo = useCallback(
    (target: VerseRef, translationId: string) => {
      const bsb = toBsbRef(target, translationId)
      const saved = positionStore.moveTo(bsb)
      // A verse BSB rejects keeps the last saved one as its anchor.
      const anchor = saved ? bsb : readerStartRef(positionStore.getSnapshot())
      const exact =
        saved && sameRef(toTranslationRef(bsb, translationId), target)
      setLocalStop(
        exact || !anchor ? null : { translationId, ref: target, anchor },
      )
    },
    [positionStore],
  )

  return { state, catalog, offline, retry, switchToOnDevice, goTo }
}
