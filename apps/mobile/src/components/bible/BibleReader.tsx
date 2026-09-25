import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import {
  Platform,
  StyleSheet,
  Text,
  View,
  useColorScheme,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native"
import { StatusBar } from "expo-status-bar"
import { useIsFocused } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useWatchPreferences } from "../../contexts/WatchPreferencesProvider"
import { useIsTabletLayout } from "../../hooks/useIsTabletLayout"
import { useReduceMotion } from "../../hooks/useReduceMotion"
import { useScreenReaderEnabled } from "../../hooks/useScreenReaderEnabled"
import { BACK_SWIPE_EDGE_WIDTH } from "../../lib/backSwipe"
import type { CatalogTranslation } from "../../lib/bible/data/catalog"
import { verseBox, type ObstacleRect } from "../../lib/bible/fit/verseBox"
import { isNoNetworkFailure } from "../../lib/bible/language/defaultTranslation"
import {
  readerTouchZones,
  type ScrollEdges,
} from "../../lib/bible/movement/gesture"
import {
  useReaderMovement,
  type MovePlace,
} from "../../lib/bible/movement/useReaderMovement"
import {
  getReaderOnboardingStore,
  useReaderOnboarding,
  type ReaderOnboardingStore,
} from "../../lib/bible/onboarding/store"
import { useReadingPosition } from "../../lib/bible/position/store"
import {
  READER_CHROME_MAX_FONT_SCALE,
  readerBottomInset,
  readerChromeBand,
  readerFooterHeight,
  readerMovementBandHeight,
  type ReaderHost,
  type ReaderLayout,
} from "../../lib/bible/reader/chrome"
import { READER_COPY } from "../../lib/bible/reader/copy"
import {
  chapterLabel,
  chapterProgress,
  counterAccessibilityLabel,
  counterLabel,
  downloadLabel,
  passageLabel,
  stopIndexForVerse,
  stopRange,
  translationLabel,
  verseRangeLabel,
} from "../../lib/bible/reader/labels"
import {
  getReaderServices,
  type ReaderServices,
} from "../../lib/bible/reader/services"
import { useDelayedFlag } from "../../lib/bible/reader/useDelayedFlag"
import {
  useReaderChapter,
  type ReaderChapterState,
} from "../../lib/bible/reader/useReaderChapter"
import { readerTextSize } from "../../lib/bible/settings/snapshot"
import { useReaderSettings } from "../../lib/bible/settings/store"
import { bookByUsfm } from "../../lib/bible/text/books"
import { chapterPositions } from "../../lib/bible/text/positions"
import type { ChapterPosition } from "../../lib/bible/text/types"
import {
  readerTokens,
  resolveReaderScheme,
  type ReaderTokens,
} from "../../lib/bible/theme/palettes"
import type { VerseRef } from "../../lib/bible/versification/convert"
import { ArrowPair } from "./ArrowPair"
import { ReaderFooter } from "./ReaderFooter"
import { ReaderGestures } from "./ReaderGestures"
import { ReaderLoading } from "./ReaderLoading"
import { ReaderMessage, type ReaderMessageAction } from "./ReaderMessage"
import { ReaderTopBar } from "./ReaderTopBar"
import { SwipeDemo } from "./SwipeDemo"
import { SwipeHint } from "./SwipeHint"
import {
  VerseView,
  type VerseAccessibilityMove,
  type VerseAppearance,
} from "./VerseView"

/** A load faster than this shows no indicator, so nothing flashes. */
export const READER_LOADING_DELAY_MS = 300

/** The verse column: a margin on each side and a readable width on iPad. */
const VERSE_SIDE_MARGIN = 24
const VERSE_MAX_WIDTH = 620

/** What a sheet or route needs from the reader when a control opens it. */
export type ReaderRouteContext = {
  /** The translation whose text shows; null before the first choice. */
  translation: CatalogTranslation | null
  /** The current verse in that translation's numbering (R42). */
  translationRef: VerseRef | null
  /** The reading position in BSB numbering (R38). */
  ref: VerseRef | null
  /** A request this visit got no network answer (R41, U10's offline list). */
  offline: boolean
}

type BibleReaderSharedProps = {
  /** The pill (R17, U10's passage picker). */
  onOpenPassagePicker: (context: ReaderRouteContext) => void
  /** The footer's translation label (R23, R25, U10's translation picker). */
  onOpenTranslationPicker: (context: ReaderRouteContext) => void
  onOpenSettings: (context: ReaderRouteContext) => void
  /** The top bar's download button (R29, R30, U10). */
  onOpenDownload: (context: ReaderRouteContext) => void
  /** The space under the footer; the default follows the host (chrome.ts). */
  bottomInset?: number
  /** U13: frames floating over the reader, such as the mini player window. */
  floatingObstacles?: readonly ObstacleRect[]
  /** Tests pass fakes; the app uses its singletons. */
  services?: ReaderServices
  /** The hint and demo flags (R15, R16); the app uses its singleton. */
  onboardingStore?: ReaderOnboardingStore
}

export type BibleReaderProps = BibleReaderSharedProps &
  (
    | { host: Extract<ReaderHost, "tab">; onBack?: never }
    | { host: Extract<ReaderHost, "pushed">; onBack: () => void }
  )

/** Each focus of the reader's screen is one reader open (AE16, R15). */
function useReaderOpens(focused: boolean): number {
  const [opens, setOpens] = useState(0)
  useEffect(() => {
    if (focused) setOpens((count) => count + 1)
  }, [focused])
  return opens
}

// The shared Bible reader (feat-551 U7, U8): one verse centered on the screen,
// a top bar, and a footer. Swipes, the arrow pair, and the screen reader move
// the verse. The Bible tab and the pushed reader render it.
export function BibleReader(props: BibleReaderProps) {
  const services = props.services ?? getReaderServices()
  const settings = useReaderSettings(services.settingsStore)
  const onboardingStore = props.onboardingStore ?? getReaderOnboardingStore()
  const onboarding = useReaderOnboarding(onboardingStore)
  const position = useReadingPosition(services.positionStore)
  const systemScheme = useColorScheme()
  const tokens = readerTokens(
    settings.palette,
    resolveReaderScheme(settings.mode, systemScheme),
  )
  const focused = useIsFocused()
  const { audioLanguageIso3, isReady } = useWatchPreferences()
  const chapter = useReaderChapter({
    services,
    position,
    audioLanguage: audioLanguageIso3,
    audioReady: isReady,
    focused,
  })
  const reduceMotion = useReduceMotion()
  const screenReader = useScreenReaderEnabled()
  const opens = useReaderOpens(focused)

  const window = useWindowDimensions()
  const layout: ReaderLayout = useIsTabletLayout() ? "tablet" : "phone"
  const insets = useSafeAreaInsets()
  const bottomInset =
    props.bottomInset ??
    readerBottomInset(props.host, Platform.OS, insets.bottom)
  const [measured, setMeasured] = useState<{
    width: number
    height: number
  } | null>(null)
  const width = measured?.width ?? window.width
  const height = measured?.height ?? window.height
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width: nextWidth, height: nextHeight } = event.nativeEvent.layout
    setMeasured((previous) =>
      previous?.width === nextWidth && previous.height === nextHeight
        ? previous
        : { width: nextWidth, height: nextHeight },
    )
  }, [])

  // KD11: iPad-sized screens always show the arrows; phones show them for a
  // screen reader or the setting. The hint keeps its row until it retires.
  const arrowsShown = layout === "tablet" || screenReader || settings.showArrows
  const hintLive = !onboarding.hintRetired
  const movementBand = readerMovementBandHeight({
    arrows: arrowsShown,
    hint: hintLive,
  })
  const band = readerChromeBand({
    layout,
    safeAreaTop: insets.top,
    bottomInset,
    containerHeight: height,
  })
  const box = verseBox({
    containerHeight: height,
    topChromeBottom: band.top,
    bottomChromeTop: band.bottom - movementBand,
    floating: props.floatingObstacles,
  })
  const columnWidth = Math.max(
    0,
    Math.min(width - 2 * VERSE_SIDE_MARGIN, VERSE_MAX_WIDTH),
  )
  // R6: on iOS the pushed reader leaves the left strip to the back swipe.
  const zones = readerTouchZones({
    layout,
    safeAreaTop: insets.top,
    bottomInset,
    containerHeight: height,
    edgeGuardWidth:
      props.host === "pushed" && Platform.OS === "ios"
        ? BACK_SWIPE_EDGE_WIDTH
        : 0,
  })

  const model = useReaderModel(chapter.state)
  const place = movePlace(chapter.state, model)
  const movement = useReaderMovement({
    place,
    goTo: chapter.goTo,
    onVerseMove: onboardingStore.retireHint,
  })
  const shown = "shown" in chapter.state ? chapter.state.shown : null
  const shownTranslation = shown?.translation ?? null
  const context: ReaderRouteContext = {
    translation: shownTranslation,
    translationRef: model.translationRef,
    ref: model.ref,
    offline: chapter.offline,
  }

  // A long verse reports its scroll edges under its own stop key, so a late
  // report from the verse the reader left never gates the next one.
  const stopKey =
    place && model.stop
      ? `${place.translationId}|${place.book}|${place.chapter}|${verseRangeLabel(model.stop)}`
      : null
  const scrollEdges = useRef<{ key: string | null; edges: ScrollEdges | null }>(
    { key: null, edges: null },
  )
  const currentStopKey = useRef(stopKey)
  useEffect(() => {
    currentStopKey.current = stopKey
  })
  const onScrollEdges = useCallback(
    (edges: ScrollEdges | null) => {
      scrollEdges.current = { key: stopKey, edges }
    },
    [stopKey],
  )
  const readScrollEdges = useCallback(
    () =>
      scrollEdges.current.key === currentStopKey.current
        ? scrollEdges.current.edges
        : null,
    [],
  )

  // R16: the demo plays first, once per install, and a screen reader or
  // Reduce Motion skips it. The hint then plays once per open (R15).
  const chapterReady = chapter.state.status === "ready"
  const demoPending = !onboarding.demoPlayed && !screenReader && !reduceMotion
  const showDemo =
    onboarding.status === "ready" && demoPending && focused && chapterReady
  const canStartHint = hintLive && !demoPending && focused && chapterReady
  const [hintOpen, setHintOpen] = useState<number | null>(null)
  useEffect(() => {
    if (canStartHint) setHintOpen(opens)
  }, [canStartHint, opens])

  const { downloads } = services
  const downloadState = useSyncExternalStore(
    downloads.subscribe,
    () => (shownTranslation ? downloads.getState(shownTranslation.id) : null),
    () => null,
  )
  const viewerTranslation =
    shown && chapter.catalog
      ? (chapter.catalog.byId.get(shown.viewer.translationId) ?? null)
      : null

  const pending =
    chapter.state.status === "waiting" || chapter.state.status === "loading"
  const showLoading = useDelayedFlag(pending, READER_LOADING_DELAY_MS)

  if (settings.status === "loading" || onboarding.status === "loading") {
    // The saved theme, size, and hint are one read away; a flash is worse.
    return (
      <View style={[styles.root, { backgroundColor: tokens.background }]} />
    )
  }

  const accessibilityMove: VerseAccessibilityMove | undefined =
    model.stop && model.total !== null && model.heading
      ? {
          value: READER_COPY.movement.verseValue(
            stopRange(model.stop).first,
            stopRange(model.stop).last,
            model.total,
            model.heading,
          ),
          onAction: (action) => {
            if (action === "increment") movement.moveVerse("forward")
            else if (action === "decrement") movement.moveVerse("back")
            else if (action === "nextChapter") movement.moveChapter("forward")
            else movement.moveChapter("back")
          },
        }
      : undefined
  const aboveFooter = bottomInset + readerFooterHeight(layout)

  return (
    <View
      testID="bible-reader"
      style={[styles.root, { backgroundColor: tokens.background }]}
      onLayout={onLayout}
    >
      {/* The tab stays mounted, so only a focused reader sets the bar. */}
      {focused && <StatusBar style={tokens.statusBarStyle} />}
      <ReaderTopBar
        tokens={tokens}
        safeAreaTop={insets.top}
        onBack={props.host === "pushed" ? props.onBack : undefined}
        passage={model.passage}
        onPressPassage={() => props.onOpenPassagePicker(context)}
        pulse={movement.pulse}
        reduceMotion={reduceMotion}
        download={{
          state: downloadState,
          accessibilityLabel: shownTranslation
            ? downloadLabel(
                downloadState ?? { kind: "checking" },
                shownTranslation,
              )
            : READER_COPY.download.waiting,
        }}
        onPressDownload={() => props.onOpenDownload(context)}
        onPressSettings={() => props.onOpenSettings(context)}
      />
      <ReaderGestures
        tokens={tokens}
        zones={zones}
        readScrollEdges={readScrollEdges}
        onVerseSwipe={movement.moveVerse}
        onChapterSwipe={movement.moveChapter}
        chapterPreview={movement.chapterPreview}
      >
        <View
          testID="bible-verse-area"
          style={[styles.verseArea, { top: box.top, height: box.height }]}
        >
          <VerseArea
            state={chapter.state}
            model={model}
            tokens={tokens}
            showLoading={showLoading}
            appearance={{
              chosenSize: readerTextSize(settings.textSizeStep),
              osFontScale: window.fontScale,
              typeface: settings.typeface,
              lineSpacing: settings.lineSpacing,
              verseNumbers: settings.verseNumbers,
            }}
            areaHeight={box.height}
            columnWidth={columnWidth}
            onRetry={chapter.retry}
            onSwitch={chapter.switchToOnDevice}
            accessibilityMove={accessibilityMove}
            onScrollEdges={onScrollEdges}
          />
        </View>
      </ReaderGestures>
      {movementBand > 0 && (
        <View
          testID="bible-movement-band"
          pointerEvents="box-none"
          style={[
            styles.movementBand,
            { bottom: aboveFooter, height: movementBand },
          ]}
        >
          {hintLive && (
            <SwipeHint
              tokens={tokens}
              reduceMotion={reduceMotion}
              playKey={hintOpen}
            />
          )}
          {arrowsShown && (
            <ArrowPair
              tokens={tokens}
              onPrevious={() => movement.moveVerse("back")}
              onNext={() => movement.moveVerse("forward")}
            />
          )}
        </View>
      )}
      {movement.notice && (
        <View
          pointerEvents="none"
          style={[styles.notice, { bottom: aboveFooter + movementBand + 8 }]}
        >
          <Text
            testID="bible-reader-notice"
            style={[
              styles.noticeText,
              {
                color: tokens.text,
                backgroundColor: tokens.buttonSurface,
              },
            ]}
            maxFontSizeMultiplier={READER_CHROME_MAX_FONT_SCALE}
          >
            {movement.notice.text}
          </Text>
        </View>
      )}
      <ReaderFooter
        tokens={tokens}
        layout={layout}
        bottomInset={bottomInset}
        heading={model.heading}
        counter={model.counter}
        progress={model.progress}
        translation={shown ? translationLabel(shown, viewerTranslation) : null}
        onPressTranslation={() => props.onOpenTranslationPicker(context)}
      />
      {showDemo && (
        <SwipeDemo tokens={tokens} onDone={onboardingStore.markDemoPlayed} />
      )}
    </View>
  )
}

export type ReaderModel = {
  ref: VerseRef | null
  translationRef: VerseRef | null
  /** The chapter's reader stops; empty until the text is ready. */
  stops: readonly ChapterPosition[]
  /** The current reader stop; null until the chapter text is ready. */
  stop: ChapterPosition | null
  stopIndex: number | null
  /** The chapter's last verse number (KTD19); null until the text is ready. */
  total: number | null
  passage: string | null
  heading: string | null
  counter: { text: string; accessibilityLabel: string } | null
  progress: number
}

const NO_STOPS: readonly ChapterPosition[] = []

/** The labels for the current stop, in the shown translation's numbers. */
function useReaderModel(state: ReaderChapterState): ReaderModel {
  const text = state.status === "ready" ? state.text : null
  const positions = useMemo(
    () => (text ? chapterPositions(text.chapter) : NO_STOPS),
    [text],
  )
  if (state.status === "waiting" || state.status === "catalog-failed") {
    return {
      ref: null,
      translationRef: null,
      stops: NO_STOPS,
      stop: null,
      stopIndex: null,
      total: null,
      passage: null,
      heading: null,
      counter: null,
      progress: 0,
    }
  }
  const { ref, translationRef } = state
  if (!text) {
    const bookName = bookByUsfm(ref.book).name
    return {
      ref,
      translationRef,
      stops: NO_STOPS,
      stop: null,
      stopIndex: null,
      total: null,
      passage: `${chapterLabel(bookName, translationRef.chapter)}:${translationRef.verse}`,
      heading: chapterLabel(bookName, translationRef.chapter),
      counter: null,
      progress: 0,
    }
  }
  const { bookName, chapter } = text
  const stopIndex = stopIndexForVerse(positions, translationRef.verse)
  const stop = positions[stopIndex] ?? null
  return {
    ref,
    translationRef,
    stops: positions,
    stop,
    stopIndex: stop ? stopIndex : null,
    total: chapter.lastVerse,
    passage: stop ? passageLabel(bookName, chapter.number, stop) : null,
    heading: chapterLabel(bookName, chapter.number),
    counter: stop
      ? {
          text: counterLabel(stop, chapter.lastVerse),
          accessibilityLabel: counterAccessibilityLabel(
            stop,
            chapter.lastVerse,
          ),
        }
      : null,
    progress: stop ? chapterProgress(stop, chapter.lastVerse) : 0,
  }
}

/** Where a move starts (U8); null before a translation shows. */
function movePlace(
  state: ReaderChapterState,
  model: ReaderModel,
): MovePlace | null {
  if (!("shown" in state)) return null
  const { translationRef, shown } = state
  const text = state.status === "ready" ? state.text : null
  return {
    book: translationRef.book,
    chapter: translationRef.chapter,
    translationId: shown.translation.id,
    bookName: text?.bookName ?? bookByUsfm(translationRef.book).name,
    stops: text ? model.stops : null,
    stopIndex: text ? model.stopIndex : null,
  }
}

type VerseAreaProps = {
  state: ReaderChapterState
  model: ReaderModel
  tokens: ReaderTokens
  showLoading: boolean
  appearance: VerseAppearance
  areaHeight: number
  columnWidth: number
  onRetry: () => void
  onSwitch: () => void
  accessibilityMove: VerseAccessibilityMove | undefined
  onScrollEdges: (edges: ScrollEdges | null) => void
}

function VerseArea({
  state,
  model,
  tokens,
  showLoading,
  appearance,
  areaHeight,
  columnWidth,
  onRetry,
  onSwitch,
  accessibilityMove,
  onScrollEdges,
}: VerseAreaProps) {
  const retry: ReaderMessageAction = {
    label: READER_COPY.failure.retry,
    onPress: onRetry,
  }
  switch (state.status) {
    case "waiting":
    case "loading":
      return showLoading ? <ReaderLoading tokens={tokens} /> : null
    case "catalog-failed":
      return (
        <ReaderMessage
          tokens={tokens}
          title={READER_COPY.failure.catalogTitle}
          body={READER_COPY.failure.catalogBody}
          actions={[retry]}
        />
      )
    case "failed": {
      const offline = isNoNetworkFailure(state.reason)
      const actions = state.switchTarget
        ? [
            retry,
            {
              label: READER_COPY.failure.switchTo(state.switchTarget.shortName),
              onPress: onSwitch,
            },
          ]
        : [retry]
      return (
        <ReaderMessage
          tokens={tokens}
          title={
            offline
              ? READER_COPY.failure.offlineTitle
              : READER_COPY.failure.failedTitle
          }
          body={
            offline
              ? READER_COPY.failure.offlineBody
              : READER_COPY.failure.failedBody
          }
          actions={actions}
        />
      )
    }
    case "ready":
      return model.stop ? (
        <VerseView
          stop={model.stop}
          textDirection={state.text.textDirection}
          appearance={appearance}
          tokens={tokens}
          areaHeight={areaHeight}
          columnWidth={columnWidth}
          accessibilityMove={accessibilityMove}
          onScrollEdges={onScrollEdges}
        />
      ) : null
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  verseArea: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  movementBand: {
    position: "absolute",
    left: 0,
    right: 0,
    justifyContent: "flex-end",
  },
  notice: {
    position: "absolute",
    left: 24,
    right: 24,
    alignItems: "center",
  },
  noticeText: {
    overflow: "hidden",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 15,
    lineHeight: 20,
    fontFamily: "System",
    textAlign: "center",
  },
})
