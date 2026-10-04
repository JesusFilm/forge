import { useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"
import { useRouter } from "expo-router"

import { ScreenTopBar } from "../src/components/ui/ScreenTopBar"
import { useMiniPlayerBottomClearance } from "../src/hooks/useMiniPlayerBottomClearance"
import { useTypography } from "../src/hooks/useTypography"
import { useTextDirection } from "../src/i18n/textDirection"
import { useT } from "../src/i18n/useT"
import { formatAppVersion, readAppVersionParts } from "../src/lib/appVersion"
import {
  BG_COLOR,
  SURFACE_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "../src/lib/color"
import { WINDOW_EDGE_MARGIN } from "../src/lib/miniPlayer/layout"
import {
  MY_WATCH_LINK_GROUPS,
  type MyWatchLink,
  type MyWatchRouteLink,
  type MyWatchSocialLink,
} from "../src/lib/myWatchLinks"
import { openExternalUrl } from "../src/lib/openExternalUrl"
import {
  CARD_BORDER_RADIUS,
  HORIZONTAL_PADDING,
  button,
  feedback,
  text,
} from "../src/styles/shared"

export default function MoreScreen() {
  const typography = useTypography()
  const t = useT("More")
  const tMyWatch = useT("MyWatch")
  const uiDirection = useTextDirection().ui
  // Read once: the native version cannot change while the app runs.
  const [versionParts] = useState(readAppVersionParts)
  const versionLine = formatAppVersion(versionParts, t)
  const paddingBottom = useMiniPlayerBottomClearance() + WINDOW_EDGE_MARGIN

  return (
    <View style={styles.screen}>
      <ScreenTopBar title={tMyWatch("moreTitle")} showBack />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom }]}
        showsVerticalScrollIndicator={false}
      >
        {MY_WATCH_LINK_GROUPS.map((group) => (
          <View
            key={group.id}
            testID={`more-group-${group.id}`}
            style={styles.group}
          >
            <Text
              accessibilityRole="header"
              style={[
                text.eyebrow,
                styles.groupTitle,
                typography.caption,
                uiDirection,
              ]}
            >
              {t(group.titleKey)}
            </Text>
            <View style={styles.card}>
              {group.links.map((link, index) =>
                "route" in link ? (
                  <RouteRow
                    key={link.labelKey}
                    link={link}
                    separated={index > 0}
                  />
                ) : (
                  <LinkRow
                    key={link.labelKey}
                    link={link}
                    separated={index > 0}
                  />
                ),
              )}
            </View>
            {group.socials != null && (
              <View style={styles.socialRow}>
                {group.socials.map((link) => (
                  <SocialButton key={link.label} link={link} />
                ))}
              </View>
            )}
          </View>
        ))}
        {versionLine != null && (
          <Text style={[styles.version, typography.caption]}>
            {versionLine}
          </Text>
        )}
      </ScrollView>
    </View>
  )
}

function LinkRow({
  link,
  separated,
}: {
  link: MyWatchLink
  separated: boolean
}) {
  const typography = useTypography()
  const t = useT("More")
  const uiDirection = useTextDirection().ui
  const label = t(link.labelKey)

  return (
    <Pressable
      onPress={() => openExternalUrl(link.url)}
      style={({ pressed }) => [
        styles.row,
        separated && styles.rowSeparator,
        pressed && feedback.pressed,
      ]}
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityHint={t("linkHint")}
      {...{ "dd-action-name": link.actionName }}
    >
      <Text
        style={[styles.rowLabel, typography.body, uiDirection]}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Ionicons name="open-outline" size={18} color={TEXT_SECONDARY} />
    </Pressable>
  )
}

// Stays in the app, so it reads as a button with a chevron like the My Watch
// rows. It navigates, as they do: a double tap must not push a second sheet.
function RouteRow({
  link,
  separated,
}: {
  link: MyWatchRouteLink
  separated: boolean
}) {
  const typography = useTypography()
  const router = useRouter()
  const t = useT("More")
  const uiDirection = useTextDirection().ui
  const label = t(link.labelKey)

  return (
    <Pressable
      onPress={() => router.navigate(link.route)}
      style={({ pressed }) => [
        styles.row,
        separated && styles.rowSeparator,
        pressed && feedback.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t(link.hintKey)}
      {...{ "dd-action-name": link.actionName }}
    >
      <Text
        style={[styles.rowLabel, typography.body, uiDirection]}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Ionicons name="chevron-forward" size={18} color={TEXT_SECONDARY} />
    </Pressable>
  )
}

function SocialButton({ link }: { link: MyWatchSocialLink }) {
  const t = useT("More")
  return (
    <Pressable
      onPress={() => openExternalUrl(link.url)}
      style={({ pressed }) => [
        button.iconButton44,
        pressed && feedback.pressed,
      ]}
      accessibilityRole="link"
      accessibilityLabel={link.label}
      accessibilityHint={t("linkHint")}
      {...{ "dd-action-name": link.actionName }}
    >
      <Ionicons name={link.icon} size={24} color={TEXT_PRIMARY} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG_COLOR,
  },
  content: {
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingTop: 8,
  },
  group: {
    marginBottom: 28,
  },
  groupTitle: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  card: {
    backgroundColor: SURFACE_COLOR,
    borderRadius: CARD_BORDER_RADIUS,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rowSeparator: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255, 255, 255, 0.1)",
  },
  rowLabel: {
    flex: 1,
    color: TEXT_PRIMARY,
    fontFamily: "System",
    marginRight: 12,
  },
  socialRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    // The 24pt glyph sits 10pt inside its 44pt target; this lines it up with
    // the row labels above.
    paddingHorizontal: 6,
  },
  version: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    textAlign: "center",
  },
})
