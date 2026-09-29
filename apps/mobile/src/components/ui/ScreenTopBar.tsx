import type { ComponentProps } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useRouter } from "expo-router"

import { useTypography } from "../../hooks/useTypography"
import { BG_COLOR, TEXT_PRIMARY } from "../../lib/color"
import { HORIZONTAL_PADDING, button, feedback } from "../../styles/shared"
import { HOME_HEADER_ROW_TOP } from "./homeHeaderLayout"

export type ScreenTopBarAction = {
  icon: ComponentProps<typeof Ionicons>["name"]
  accessibilityLabel: string
  onPress: () => void
}

export type ScreenTopBarProps = {
  title: string
  /** Adds a leading back control, for a screen pushed over My Watch. */
  showBack?: boolean
  trailingAction?: ScreenTopBarAction
}

const TARGET_SIZE = 44
// Pulls each 44pt target out so its glyph lines up with the content edge.
const EDGE_PULL = 10

export function ScreenTopBar({
  title,
  showBack = false,
  trailingAction,
}: ScreenTopBarProps) {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const typography = useTypography()

  const handleBack = () => {
    // A cold deep link lands on an empty stack, where back() does nothing.
    if (router.canGoBack()) router.back()
    else router.navigate("/(tabs)/profile")
  }

  return (
    <View
      style={[styles.bar, { paddingTop: insets.top + HOME_HEADER_ROW_TOP }]}
    >
      <View style={styles.row}>
        {showBack && (
          <Pressable
            onPress={handleBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={({ pressed }) => [
              button.iconButton44,
              styles.leading,
              pressed && feedback.pressed,
            ]}
          >
            <Ionicons name="chevron-back" size={28} color={TEXT_PRIMARY} />
          </Pressable>
        )}
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={[
            styles.title,
            showBack ? typography.titleLarge : typography.headingScale.h2,
          ]}
        >
          {title}
        </Text>
        {trailingAction != null && (
          <Pressable
            onPress={trailingAction.onPress}
            accessibilityRole="button"
            accessibilityLabel={trailingAction.accessibilityLabel}
            style={({ pressed }) => [
              button.iconButton44,
              styles.trailing,
              pressed && feedback.pressed,
            ]}
          >
            <Ionicons
              name={trailingAction.icon}
              size={26}
              color={TEXT_PRIMARY}
            />
          </Pressable>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: BG_COLOR,
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingBottom: 8,
  },
  row: {
    minHeight: TARGET_SIZE,
    flexDirection: "row",
    alignItems: "center",
  },
  leading: {
    marginLeft: -EDGE_PULL,
  },
  trailing: {
    marginRight: -EDGE_PULL,
  },
  title: {
    flex: 1,
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "700",
  },
})
