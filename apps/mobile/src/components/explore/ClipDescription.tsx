import { useCallback, useEffect, useRef, useState } from "react"
import {
  LayoutAnimation,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
} from "react-native"

import { useTextDirection } from "../../i18n/textDirection"
import { useT } from "../../i18n/useT"
import { TEXT_ON_OVERLAY } from "../../lib/color"
import { useReduceMotion } from "../../hooks/useReduceMotion"
import {
  useTextOverflow,
  type TextLayoutEvent,
} from "../../hooks/useTextOverflow"
import { useTypography } from "../../hooks/useTypography"
import { useExplorePagerHold } from "./ExplorePager"

export type ClipDescriptionProps = {
  description: string | null
  /** The language of `description` (KTD13); null when it is not known. */
  descriptionLang?: string | null
  /** "more" was tapped. The clip keeps playing; the overlay holds the video. */
  onExpand: () => void
  /** "less" was tapped. */
  onCollapse: () => void
}

/** The open and close animation: the text grows or shrinks, and fades. */
export const DESCRIPTION_TOGGLE_ANIMATION = LayoutAnimation.create(
  250,
  LayoutAnimation.Types.easeInEaseOut,
  LayoutAnimation.Properties.opacity,
)

const COLLAPSED_LINES = 1
/** An open description scrolls past this share of the screen height. */
const EXPANDED_MAX_SCREEN_SHARE = 0.4
/** 12 above and below a 20 pt line gives the 44 pt touch floor. */
const TOGGLE_HIT_SLOP = { top: 12, bottom: 12, left: 8, right: 8 }

function overflowsOneLine(e: TextLayoutEvent): boolean {
  return e.nativeEvent.lines.length > COLLAPSED_LINES
}

/** The clip's description: one line, with "more" at its end when it overflows (R15). */
export function ClipDescription({
  description,
  descriptionLang,
  onExpand,
  onCollapse,
}: ClipDescriptionProps) {
  const typography = useTypography()
  const t = useT("Explore")
  const bodyDirection = useTextDirection().text(descriptionLang)
  const { height } = useWindowDimensions()
  // The hook's reset on new text does not call `onCollapse`: a swipe has
  // already cleared the feed's pause, and a late call would act on the next clip.
  const { overflows, expanded, setExpanded, handleMeasureLayout } =
    useTextOverflow(description, overflowsOneLine)
  const reduceMotion = useReduceMotion()

  // The next commit animates, so set up the animation before the state flips.
  const animateToggle = useCallback(() => {
    if (!reduceMotion)
      LayoutAnimation.configureNext(DESCRIPTION_TOGGLE_ANIMATION)
  }, [reduceMotion])

  const handleExpand = useCallback(() => {
    animateToggle()
    setExpanded(true)
    onExpand()
  }, [animateToggle, onExpand, setExpanded])

  const handleCollapse = useCallback(() => {
    animateToggle()
    setExpanded(false)
    onCollapse()
  }, [animateToggle, onCollapse, setExpanded])

  if (description == null || description.length === 0) return null

  const bodyStyle = [styles.body, typography.bodySmall, bodyDirection.style]
  const toggleStyle = [styles.toggleText, typography.bodySmall]

  return (
    <View>
      {expanded ? (
        <OpenDescription
          description={description}
          maxHeight={Math.round(height * EXPANDED_MAX_SCREEN_SHARE)}
          bodyStyle={bodyStyle}
          bodyLanguage={bodyDirection.accessibilityLanguage}
          toggleStyle={toggleStyle}
          onCollapse={handleCollapse}
        />
      ) : (
        <View style={styles.row}>
          <Text
            style={[bodyStyle, styles.line]}
            numberOfLines={COLLAPSED_LINES}
            accessibilityLanguage={bodyDirection.accessibilityLanguage}
          >
            {description}
          </Text>
          {overflows === true && (
            <Pressable
              onPress={handleExpand}
              hitSlop={TOGGLE_HIT_SLOP}
              style={styles.more}
              accessibilityRole="button"
              accessibilityLabel={t("descriptionMoreAriaLabel")}
              {...{ "dd-action-name": "explore-description-more" }}
            >
              <Text style={toggleStyle}>{t("descriptionMore")}</Text>
            </Pressable>
          )}
        </View>
      )}
      {/* The visible copy carries numberOfLines, so only this unconstrained,
          hidden copy can tell a cut line from a short one. */}
      <View
        style={styles.measure}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Text style={bodyStyle} onTextLayout={handleMeasureLayout}>
          {description}
        </Text>
      </View>
    </View>
  )
}

type Finger = { identifier: string | number }

/** The fingers on this view. iOS sends a finger's events only to the view it
 *  started on and names them in `targetTouches`; Android sends no such list,
 *  but routes every finger of a gesture to the view its first finger hit. */
function ownFingers(e: GestureResponderEvent): readonly Finger[] {
  const native = e.nativeEvent as { targetTouches?: readonly Finger[] }
  return native.targetTouches ?? e.nativeEvent.changedTouches
}

type OpenDescriptionProps = {
  description: string
  maxHeight: number
  bodyStyle: StyleProp<TextStyle>
  /** The description's language for VoiceOver (KTD13). */
  bodyLanguage?: string
  toggleStyle: StyleProp<TextStyle>
  onCollapse: () => void
}

/** The open description. While its text scrolls, a finger on it holds the
 *  pager, so a drag scrolls the text and never moves the feed (2026-10-01). */
function OpenDescription({
  description,
  maxHeight,
  bodyStyle,
  bodyLanguage,
  toggleStyle,
  onCollapse,
}: OpenDescriptionProps) {
  const t = useT("Explore")
  const holdPager = useExplorePagerHold()
  const [viewport, setViewport] = useState(0)
  const [content, setContent] = useState(0)
  const scrolls = viewport > 0 && content - viewport > 1

  const fingers = useRef(new Set<string>())
  const release = useRef<(() => void) | null>(null)
  const releasePager = useCallback(() => {
    fingers.current.clear()
    release.current?.()
    release.current = null
  }, [])
  // "less" unmounts this view under the finger, before its touch end lands.
  useEffect(() => releasePager, [releasePager])
  // A clip that ends while the text is open loops (owner, 2026-10-01).
  useEffect(() => holdPager?.("feedMove"), [holdPager])

  // Touch events reach this view whoever holds the responder: a scroll view
  // that coasts takes the touch start itself, ahead of every child.
  const handleTouchStart = useCallback(
    (e: GestureResponderEvent) => {
      if (!scrolls || holdPager == null) return
      for (const finger of ownFingers(e)) {
        fingers.current.add(String(finger.identifier))
      }
      if (fingers.current.size > 0) release.current ??= holdPager("drag")
    },
    [holdPager, scrolls],
  )
  // The surface's `touches` may never empty here: a finger elsewhere keeps it
  // full, and that finger's end never reaches this view (code review).
  const handleTouchEnd = useCallback(
    (e: GestureResponderEvent) => {
      for (const finger of e.nativeEvent.changedTouches) {
        fingers.current.delete(String(finger.identifier))
      }
      if (fingers.current.size === 0 || e.nativeEvent.touches.length === 0) {
        releasePager()
      }
    },
    [releasePager],
  )

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    setViewport(e.nativeEvent.layout.height)
  }, [])
  const handleContentSize = useCallback((_width: number, h: number) => {
    setContent(h)
  }, [])

  return (
    <ScrollView
      style={{ maxHeight }}
      nestedScrollEnabled
      onLayout={handleLayout}
      onContentSizeChange={handleContentSize}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={releasePager}
    >
      <Text style={bodyStyle} accessibilityLanguage={bodyLanguage}>
        {description}
      </Text>
      <Pressable
        onPress={onCollapse}
        hitSlop={TOGGLE_HIT_SLOP}
        style={styles.less}
        accessibilityRole="button"
        accessibilityLabel={t("descriptionLessAriaLabel")}
        {...{ "dd-action-name": "explore-description-less" }}
      >
        <Text style={toggleStyle}>{t("descriptionLess")}</Text>
      </Pressable>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  line: {
    flexShrink: 1,
  },
  body: {
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
  },
  toggleText: {
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
    fontWeight: "700",
  },
  more: {
    marginLeft: 6,
  },
  less: {
    alignSelf: "flex-start",
    marginTop: 4,
  },
  // Zero height and clipped: the text still lays out at full width, so its
  // line count is real, but it takes no space and paints nothing.
  measure: {
    height: 0,
    overflow: "hidden",
  },
})
