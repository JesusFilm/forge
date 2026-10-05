import { useEffect, useState } from "react"
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutRectangle,
} from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { useT } from "../../i18n/useT"
import {
  READER_CHROME_MAX_FONT_SCALE,
  READER_TOUCH_TARGET,
  READER_TOP_BAR_HEIGHT,
  READER_TOP_BAR_OFFSET,
} from "../../lib/bible/reader/chrome"
import type {
  PillDownloadStatus,
  TranslationLabel,
} from "../../lib/bible/reader/labels"
import type { ReaderTokens } from "../../lib/bible/theme/palettes"
import { HORIZONTAL_PADDING } from "../../styles/shared"
import { ChapterPill } from "./ChapterPill"
import { ReaderGlassButton } from "./ReaderGlassButton"
import { ReaderProgressRing } from "./ReaderProgressRing"

export type ReaderTopBarProps = {
  tokens: ReaderTokens
  safeAreaTop: number
  /** The pushed reader's back button (R6); the Bible tab has none. */
  onBack?: () => void
  /** The pill's reference in the shown numbering, or null while waiting. */
  passage: string | null
  onPressPassage: () => void
  /** R39: a new value animates the pill; U8 counts chapter changes. */
  pulse: number
  reduceMotion: boolean
  /** R23: the shown translation, or null while waiting. */
  translation: TranslationLabel | null
  onPressTranslation: () => void
  /** A running download of the shown translation, as a ring in the pill. */
  translationStatus: PillDownloadStatus | null
  onPressSettings: () => void
}

/** R8: back, the pill, and the translation pill at the left (owner,
 *  2026-09-27); settings at the right. The download button is on the
 *  translation sheet's Current card (owner, 2026-10-01). */
export function ReaderTopBar({
  tokens,
  safeAreaTop,
  onBack,
  passage,
  onPressPassage,
  pulse,
  reduceMotion,
  translation,
  onPressTranslation,
  translationStatus,
  onPressSettings,
}: ReaderTopBarProps) {
  const t = useT("BibleReader")
  const common = useT("Common")
  const note = translation?.note ?? null
  const noteKey = translation?.noteKey ?? null
  // The stand-in the open tip is for. Its text can change while a book name
  // loads; another stand-in (or none) closes the tip, and it stays closed.
  const [tip, setTip] = useState<string | null>(null)
  if (tip !== null && tip !== noteKey) setTip(null)
  const tipOpen = tip !== null && tip === noteKey
  useEffect(() => {
    if (!tipOpen) return
    const timer = setTimeout(() => setTip(null), STAND_IN_TIP_MS)
    return () => clearTimeout(timer)
  }, [tipOpen, tip])
  const toggleTip = () => {
    if (tipOpen || note === null || noteKey === null) {
      setTip(null)
      return
    }
    setTip(noteKey)
    AccessibilityInfo.announceForAccessibility(note)
  }
  const [leading, setLeading] = useState<LayoutRectangle | null>(null)
  const [infoCenter, setInfoCenter] = useState(0)

  return (
    <View
      style={[
        styles.bar,
        {
          height: safeAreaTop + READER_TOP_BAR_HEIGHT,
          paddingTop: safeAreaTop + READER_TOP_BAR_OFFSET,
        },
      ]}
      pointerEvents="box-none"
    >
      <View
        style={styles.leading}
        pointerEvents="box-none"
        onLayout={(event) => setLeading(event.nativeEvent.layout)}
      >
        {onBack && (
          <ReaderGlassButton
            tokens={tokens}
            accessibilityLabel={common("goBackAriaLabel")}
            actionName="bible-reader-back"
            onPress={onBack}
          >
            <Ionicons name="chevron-back" size={24} color={tokens.icon} />
          </ReaderGlassButton>
        )}
        <ChapterPill
          tokens={tokens}
          accessibilityLabel={
            passage
              ? t("choosePassageAriaLabel", { passage })
              : t("choosePassageWaitingAriaLabel")
          }
          actionName="bible-reader-passage"
          onPress={onPressPassage}
          disabled={passage === null}
          pulse={pulse}
          reduceMotion={reduceMotion}
        >
          {/* A narrow phone shortens the book name, never the verse. */}
          <Text
            style={[styles.passage, { color: tokens.text }]}
            numberOfLines={1}
            ellipsizeMode="middle"
            maxFontSizeMultiplier={READER_CHROME_MAX_FONT_SCALE}
          >
            {passage ?? " "}
          </Text>
        </ChapterPill>
        <ReaderGlassButton
          tokens={tokens}
          shape="pill"
          accessibilityLabel={
            translation?.accessibilityLabel ??
            t("chooseTranslationWaitingAriaLabel")
          }
          actionName="bible-reader-translation"
          onPress={onPressTranslation}
          disabled={translation === null}
          style={styles.translation}
        >
          <Text
            style={[styles.translationText, { color: tokens.text }]}
            numberOfLines={1}
            maxFontSizeMultiplier={READER_CHROME_MAX_FONT_SCALE}
          >
            {translation?.text ?? " "}
          </Text>
          {translationStatus && (
            <PillStatus status={translationStatus} tokens={tokens} />
          )}
        </ReaderGlassButton>
        {note !== null && (
          <Pressable
            testID="bible-stand-in-info"
            onPress={toggleTip}
            onLayout={(event) => {
              const { x, width } = event.nativeEvent.layout
              setInfoCenter(x + width / 2)
            }}
            accessibilityRole="button"
            accessibilityLabel={note}
            accessibilityState={{ expanded: tipOpen }}
            style={({ pressed }) => [styles.info, pressed && styles.pressed]}
            {...{ "dd-action-name": "bible-reader-stand-in-info" }}
          >
            <Ionicons
              name="information-circle-outline"
              size={22}
              color={tokens.icon}
            />
          </Pressable>
        )}
      </View>
      <View style={styles.trailing} pointerEvents="box-none">
        <ReaderGlassButton
          tokens={tokens}
          accessibilityLabel={t("settingsAriaLabel")}
          actionName="bible-reader-settings"
          onPress={onPressSettings}
        >
          <Ionicons name="settings-outline" size={22} color={tokens.icon} />
        </ReaderGlassButton>
      </View>
      {tipOpen && note !== null && leading && (
        <StandInTip
          tokens={tokens}
          note={note}
          top={leading.y + leading.height + TIP_GAP}
          // The arrow points at the info button's center.
          arrowX={leading.x + infoCenter - TIP_SIDE}
          onPress={() => setTip(null)}
        />
      )}
    </View>
  )
}

/** The pill's ring, beside the short name. */
const PILL_RING_SIZE = 16

// The owner (2026-10-01): a small ring while a download runs, so the download
// stays visible once the sheet closes. The pill's label says the percent.
function PillStatus({
  status,
  tokens,
}: {
  status: PillDownloadStatus
  tokens: ReaderTokens
}) {
  return (
    <View
      testID="reader-pill-download-ring"
      style={styles.pillStatus}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <ReaderProgressRing
        size={PILL_RING_SIZE}
        strokeWidth={2}
        progress={status.progress}
        color={tokens.icon}
        trackColor={tokens.progressTrack}
      />
    </View>
  )
}

/** Long enough to read a two-line note. */
export const STAND_IN_TIP_MS = 5000
const TIP_GAP = 8
const TIP_SIDE = HORIZONTAL_PADDING
const TIP_MAX_WIDTH = 340
const TIP_ARROW = 12

type StandInTipProps = {
  tokens: ReaderTokens
  note: string
  top: number
  arrowX: number
  onPress: () => void
}

// The stand-in's note, under the info button. It closes on a tap, on the next
// tap of the button, after STAND_IN_TIP_MS, or when the stand-in ends.
function StandInTip({ tokens, note, top, arrowX, onPress }: StandInTipProps) {
  const [width, setWidth] = useState(0)
  const arrowLeft = Math.max(
    TIP_ARROW,
    Math.min(arrowX - TIP_ARROW / 2, width - TIP_ARROW * 2),
  )
  // The page color under the button surface makes the note opaque.
  const layers = [
    { backgroundColor: tokens.background },
    { backgroundColor: tokens.buttonSurface },
  ]
  // The row spans the bar, so the note wraps at the row's width. An absolute
  // view with only a left edge measures its text on one line and clips it.
  return (
    <View pointerEvents="box-none" style={[styles.tipRow, { top }]}>
      <Pressable
        testID="bible-stand-in-tip"
        onPress={onPress}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        accessibilityRole="text"
        accessibilityLabel={note}
        style={styles.tip}
        {...{ "dd-action-name": "bible-reader-stand-in-tip" }}
      >
        <View
          style={[styles.tipArrow, { left: arrowLeft }]}
          pointerEvents="none"
        >
          {layers.map((layer, index) => (
            <View key={index} style={[StyleSheet.absoluteFill, layer]} />
          ))}
        </View>
        <View style={styles.tipBody}>
          {layers.map((layer, index) => (
            <View key={index} style={[StyleSheet.absoluteFill, layer]} />
          ))}
          <Text
            style={[styles.tipText, { color: tokens.text }]}
            maxFontSizeMultiplier={READER_CHROME_MAX_FONT_SCALE}
          >
            {note}
          </Text>
        </View>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: HORIZONTAL_PADDING - 2,
    zIndex: 2,
  },
  leading: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
    gap: 4,
  },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: 8,
  },
  passage: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "600",
    fontFamily: "System",
  },
  // The passage pill shrinks first; a short name is at most five letters.
  translation: {
    flexShrink: 0,
  },
  translationText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    fontFamily: "System",
  },
  pillStatus: {
    marginLeft: 6,
  },
  // A full touch target; the negative margin keeps the icon near the pill.
  info: {
    width: READER_TOUCH_TARGET,
    height: READER_TOUCH_TARGET,
    marginLeft: -6,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.6,
  },
  tipRow: {
    position: "absolute",
    left: TIP_SIDE,
    right: TIP_SIDE,
  },
  tip: {
    alignSelf: "flex-start",
    maxWidth: TIP_MAX_WIDTH,
  },
  tipArrow: {
    position: "absolute",
    top: -TIP_ARROW / 2,
    width: TIP_ARROW,
    height: TIP_ARROW,
    overflow: "hidden",
    transform: [{ rotate: "45deg" }],
  },
  tipBody: {
    overflow: "hidden",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  tipText: {
    fontSize: 15,
    lineHeight: 20,
    fontFamily: "System",
  },
})
