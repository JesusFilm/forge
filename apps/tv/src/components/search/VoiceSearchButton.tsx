import Ionicons from "@expo/vector-icons/Ionicons"
import { Animated, Pressable, StyleSheet } from "react-native"
import type { View as ViewType } from "react-native"

import { scale } from "../../lib/scale"
import { useFocusVisual } from "../focus/useFocusVisual"
import { WATCH_THEME } from "../watch/watchDetailTheme"
import { SEARCH_THEME } from "./searchTheme"

type Props = {
  /** A voice session is in flight — the icon goes accent as the live cue. */
  listening: boolean
  onPress: () => void
  /** One-shot mount claim: the mic owns the screen's initial D-pad focus
   *  (the keyboard's first-key claim is suppressed when the mic renders). */
  hasTVPreferredFocus?: boolean
  /** Focus-gained notification for screen-level focus-region tracking. */
  onFocusIn?: () => void
  /**
   * Exposes the native node so the screen can re-focus this button (the
   * Back-from-results landing). Ref-as-state, like KeyButton's nodeRef.
   */
  nodeRef?: (node: ViewType | null) => void
}

const BUTTON_SIZE = 56
const ICON_SIZE = Math.round(scale(30))

/**
 * The mic button at the LEFT of the search bar (Android TV). Pressing it
 * starts one SpeechRecognizer session; the transcript types itself into the
 * query. Visuals mirror KeyButton's key role (white-fill focus, focus pop).
 */
export function VoiceSearchButton({
  listening,
  onPress,
  hasTVPreferredFocus,
  onFocusIn,
  nodeRef,
}: Props) {
  const { focused, setFocused, transform, focusedShadow } = useFocusVisual(
    "key",
    { nativeDriver: false },
  )

  const inkColor = listening
    ? WATCH_THEME.accent
    : focused
      ? SEARCH_THEME.keyFocusText
      : SEARCH_THEME.keyText

  return (
    <Pressable
      ref={nodeRef}
      onPress={onPress}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={() => {
        setFocused(true)
        onFocusIn?.()
      }}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityLabel="Voice search"
      accessibilityHint="Speak into the remote to search"
      // Generic RUM action name — never carries what the user says or types.
      {...{ "dd-action-name": "voice-search" }}
    >
      <Animated.View
        style={[
          styles.button,
          focused && styles.buttonFocused,
          focused && focusedShadow,
          { transform },
        ]}
      >
        <Ionicons name="mic-outline" size={ICON_SIZE} color={inkColor} />
      </Animated.View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    width: scale(BUTTON_SIZE),
    height: scale(BUTTON_SIZE),
    borderRadius: scale(12),
    backgroundColor: SEARCH_THEME.keyBg,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonFocused: {
    backgroundColor: SEARCH_THEME.keyFocusBg,
  },
})
