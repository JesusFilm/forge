import { useCallback, useMemo, useState, useSyncExternalStore } from "react"
import {
  Platform,
  StyleSheet,
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
import type { CatalogTranslation } from "../../lib/bible/data/catalog"
import { verseBox, type ObstacleRect } from "../../lib/bible/fit/verseBox"
import { isNoNetworkFailure } from "../../lib/bible/language/defaultTranslation"
import { useReadingPosition } from "../../lib/bible/position/store"
import {
  readerBottomInset,
  readerChromeBand,
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
  translationLabel,
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
import { ReaderFooter } from "./ReaderFooter"
import { ReaderLoading } from "./ReaderLoading"
import { ReaderMessage, type ReaderMessageAction } from "./ReaderMessage"
import { ReaderTopBar } from "./ReaderTopBar"
import { VerseView, type VerseAppearance } from "./VerseView"

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
}

export type BibleReaderProps = BibleReaderSharedProps &
  (
    | { host: Extract<ReaderHost, "tab">; onBack?: never }
    | { host: Extract<ReaderHost, "pushed">; onBack: () => void }
  )

// The shared Bible reader (feat-551 U7): one verse centered on the screen,
// a top bar, and a footer. The Bible tab and the pushed reader render it.
export function BibleReader(props: BibleReaderProps) {
  const services = props.services ?? getReaderServices()
  const settings = useReaderSettings(services.settingsStore)
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

  const band = readerChromeBand({
    layout,
    safeAreaTop: insets.top,
    bottomInset,
    containerHeight: height,
  })
  const box = verseBox({
    containerHeight: height,
    topChromeBottom: band.top,
    bottomChromeTop: band.bottom,
    floating: props.floatingObstacles,
  })
  const columnWidth = Math.max(
    0,
    Math.min(width - 2 * VERSE_SIDE_MARGIN, VERSE_MAX_WIDTH),
  )

  const model = useReaderModel(chapter.state)
  const shown = "shown" in chapter.state ? chapter.state.shown : null
  const shownTranslation = shown?.translation ?? null
  const context: ReaderRouteContext = {
    translation: shownTranslation,
    translationRef: model.translationRef,
    ref: model.ref,
    offline: chapter.offline,
  }

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

  if (settings.status === "loading") {
    // The saved theme and size are one read away; a default flash is worse.
    return (
      <View style={[styles.root, { backgroundColor: tokens.background }]} />
    )
  }

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
        />
      </View>
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
    </View>
  )
}

export type ReaderModel = {
  ref: VerseRef | null
  translationRef: VerseRef | null
  /** The current reader stop; null until the chapter text is ready. */
  stop: ChapterPosition | null
  passage: string | null
  heading: string | null
  counter: { text: string; accessibilityLabel: string } | null
  progress: number
}

/** The labels for the current stop, in the shown translation's numbers. */
function useReaderModel(state: ReaderChapterState): ReaderModel {
  const text = state.status === "ready" ? state.text : null
  const positions = useMemo(
    () => (text ? chapterPositions(text.chapter) : []),
    [text],
  )
  if (state.status === "waiting" || state.status === "catalog-failed") {
    return {
      ref: null,
      translationRef: null,
      stop: null,
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
      stop: null,
      passage: `${chapterLabel(bookName, translationRef.chapter)}:${translationRef.verse}`,
      heading: chapterLabel(bookName, translationRef.chapter),
      counter: null,
      progress: 0,
    }
  }
  const { bookName, chapter } = text
  const stop =
    positions[stopIndexForVerse(positions, translationRef.verse)] ?? null
  return {
    ref,
    translationRef,
    stop,
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
})
