// Focusable on purpose: tvOS scrolls only as focus moves, so a section with no
// focusable descendant is unreachable. About was pure <Text> and leaned on the
// Related Questions column beside it — which is empty on videos like Magdalena.
// Focus IS the scroll affordance, hence no press action: focusable, inert on Select.

import { Pressable, StyleSheet, Text, View } from "react-native"

import { scale } from "../../lib/scale"
import { FOCUS_RING_COLOR, FOCUS_RING_WIDTH } from "../focus/focusVisual"
import { useFocusVisual } from "../focus/useFocusVisual"
import { SECTION_HEADING } from "../sections/sectionHeading"
import { WATCH_THEME } from "./watchDetailTheme"

export function AboutSection({ description }: { description: string }) {
  // "row" role: ring only, no motion — magnifying a paragraph reads as a glitch.
  const { focused, setFocused } = useFocusVisual("row")

  return (
    <Pressable
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      // No onPress: Pressable is focusable by default (focusable !== false &&
      // isTVSelectable !== false), so this takes focus without pretending to
      // be a button.
      accessibilityLabel="About"
      // The synopsis is long CMS prose; without this RUM would name the action
      // after the whole paragraph.
      {...{ "dd-action-name": "about-section" }}
      style={styles.pressable}
    >
      <Text style={styles.heading} accessibilityRole="header">
        About
      </Text>
      <Text style={styles.body}>{description}</Text>

      {/* Ring overlay rather than a border, so focus costs no layout shift. */}
      {focused ? <View style={styles.ring} pointerEvents="none" /> : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  // Inset padding gives the ring somewhere to sit without hugging the glyphs;
  // the negative margin keeps the text optically aligned with the rail above.
  pressable: {
    paddingVertical: scale(14),
    paddingHorizontal: scale(20),
    marginHorizontal: -scale(20),
    borderRadius: scale(16),
  },
  heading: {
    ...SECTION_HEADING,
    marginBottom: scale(18),
  },
  body: {
    fontFamily: "System",
    fontSize: Math.round(scale(25)),
    lineHeight: Math.round(scale(37)),
    color: WATCH_THEME.text,
  },
  ring: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: scale(16),
    borderWidth: FOCUS_RING_WIDTH,
    borderColor: FOCUS_RING_COLOR,
  },
})
