import { Platform, Pressable, StyleSheet, Text } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { useTypography } from "../../hooks/useTypography"
import { TEXT_PRIMARY, hexToRgba } from "../../lib/color"
import { openExternalUrl } from "../../lib/openExternalUrl"
import { feedback } from "../../styles/shared"

// The app's one in-app privacy policy link, which App Store guideline 5.1.1(i)
// requires: keep it reachable. Same URL as the web footer.
export const PRIVACY_POLICY_URL = "https://www.jesusfilm.org/privacy/"

const LABEL = "Privacy Policy"
const CONTENT_COLOR = hexToRgba(TEXT_PRIMARY, 0.9)

export function PrivacyPolicyButton() {
  const typography = useTypography()

  return (
    <Pressable
      onPress={() => openExternalUrl(PRIVACY_POLICY_URL)}
      style={({ pressed }) => [
        styles.button,
        pressed && Platform.OS === "ios" && feedback.pressed,
      ]}
      android_ripple={{ color: "rgba(255, 255, 255, 0.1)" }}
      accessibilityRole="button"
      accessibilityLabel={LABEL}
    >
      <Ionicons
        name="shield-checkmark-outline"
        size={18}
        color={CONTENT_COLOR}
      />
      <Text style={[styles.label, typography.body]}>{LABEL}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
  },
  label: {
    color: CONTENT_COLOR,
    fontFamily: "System",
    fontWeight: "600",
  },
})
