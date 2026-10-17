import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native"
import { useRouter } from "expo-router"
import Ionicons from "@expo/vector-icons/Ionicons"

import { useT } from "../../i18n/useT"
import { useTypography } from "../../hooks/useTypography"
import {
  ACCENT,
  SURFACE_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "../../lib/color"
import { feedback } from "../../styles/shared"

const ICON_WRAP_SIZE = 84

export type LibraryEmptyStateProps = {
  style?: StyleProp<ViewStyle>
  /** Replaces the default tab switch. A root-stack host must pop back to the
   *  tab navigator: navigate("/(tabs)") there pushes a second one. */
  onBrowse?: () => void
}

/** R17: only rendered once the persisted manifest has hydrated and holds zero records. */
export function LibraryEmptyState({ style, onBrowse }: LibraryEmptyStateProps) {
  const typography = useTypography()
  const router = useRouter()
  const t = useT("Library")

  return (
    <View style={[styles.root, style]}>
      <View style={styles.iconWrap}>
        <Ionicons
          name="arrow-down-circle-outline"
          size={38}
          color={TEXT_SECONDARY}
        />
      </View>
      <Text
        style={[styles.heading, typography.titleLarge]}
        accessibilityRole="header"
      >
        {t("emptyTitle")}
      </Text>
      <Text style={[styles.body, typography.body]}>{t("emptyBody")}</Text>
      <Pressable
        onPress={() => (onBrowse ? onBrowse() : router.navigate("/(tabs)"))}
        style={({ pressed }) => [styles.button, pressed && feedback.pressed]}
        accessibilityRole="button"
        accessibilityLabel={t("browseVideos")}
        {...{ "dd-action-name": "library-browse-videos" }}
      >
        <Text style={[styles.buttonText, typography.body]}>
          {t("browseVideos")}
        </Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    paddingTop: 110,
    paddingHorizontal: 36,
  },
  iconWrap: {
    width: ICON_WRAP_SIZE,
    height: ICON_WRAP_SIZE,
    borderRadius: 26,
    backgroundColor: SURFACE_COLOR,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 22,
  },
  heading: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "700",
    textAlign: "center",
  },
  body: {
    marginTop: 9,
    color: TEXT_SECONDARY,
    fontFamily: "System",
    textAlign: "center",
  },
  button: {
    marginTop: 22,
    height: 44,
    borderRadius: 22,
    paddingHorizontal: 24,
    backgroundColor: ACCENT,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "600",
  },
})
