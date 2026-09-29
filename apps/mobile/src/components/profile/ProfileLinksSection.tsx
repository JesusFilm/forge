import { Pressable, StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { useTypography } from "../../hooks/useTypography"
import { useT, type UiMessageKey } from "../../i18n/useT"
import { SURFACE_COLOR, TEXT_PRIMARY, TEXT_SECONDARY } from "../../lib/color"
import { openExternalUrl } from "../../lib/openExternalUrl"
import {
  CARD_BORDER_RADIUS,
  HORIZONTAL_PADDING,
  button,
  feedback,
} from "../../styles/shared"

type IoniconsName = React.ComponentProps<typeof Ionicons>["name"]

type ExternalLink = {
  labelKey: UiMessageKey<"Profile">
  url: string
}

type SocialLink = {
  /** A brand name, which stays as it is in every language. */
  brand: string
  icon: IoniconsName
  url: string
}

// URLs mirror apps/web/src/components/home/WatchHomeFooter.tsx (socialLinks +
// navLinks). Keep in sync when the web footer changes.
const SOCIAL_LINKS: readonly SocialLink[] = [
  { brand: "X", icon: "logo-x", url: "https://twitter.com/jesusfilm" },
  {
    brand: "Facebook",
    icon: "logo-facebook",
    url: "https://www.facebook.com/jesusfilm",
  },
  {
    brand: "Instagram",
    icon: "logo-instagram",
    url: "https://www.instagram.com/jesusfilm",
  },
  {
    brand: "YouTube",
    icon: "logo-youtube",
    url: "https://www.youtube.com/user/jesusfilm",
  },
]

const NAV_LINKS: readonly ExternalLink[] = [
  { labelKey: "giveLink", url: "https://www.jesusfilm.org/give/" },
  { labelKey: "aboutLink", url: "https://www.jesusfilm.org/about/" },
  { labelKey: "contactLink", url: "https://www.jesusfilm.org/contact/" },
  { labelKey: "newsletterLink", url: "https://www.jesusfilm.org/email/" },
  { labelKey: "privacyPolicy", url: "https://www.jesusfilm.org/privacy/" },
  { labelKey: "legalStatementLink", url: "https://www.jesusfilm.org/legal/" },
]

/** The organization's name is not translated, as on web. */
const ORGANIZATION_NAME = "Jesus Film Project"

export function ProfileLinksSection() {
  const t = useT("Profile")
  const typography = useTypography()

  return (
    <View style={styles.container}>
      <View style={styles.socialRow}>
        {SOCIAL_LINKS.map((link) => (
          <Pressable
            key={link.brand}
            onPress={() => openExternalUrl(link.url)}
            style={({ pressed }) => [
              button.iconButton44,
              pressed && feedback.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={link.brand}
          >
            <Ionicons name={link.icon} size={24} color={TEXT_PRIMARY} />
          </Pressable>
        ))}
      </View>

      <View style={styles.linkGroup}>
        {NAV_LINKS.map((link, index) => (
          <Pressable
            key={link.labelKey}
            onPress={() => openExternalUrl(link.url)}
            style={({ pressed }) => [
              styles.linkRow,
              index > 0 && styles.linkRowSeparator,
              pressed && feedback.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={t(link.labelKey)}
            {...{ "dd-action-name": `profile-link-${link.labelKey}` }}
          >
            <Text style={[styles.linkLabel, typography.body]} numberOfLines={1}>
              {t(link.labelKey)}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={TEXT_SECONDARY} />
          </Pressable>
        ))}
      </View>

      <Text style={[styles.attribution, typography.caption]}>
        {ORGANIZATION_NAME}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: HORIZONTAL_PADDING,
  },
  socialRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  linkGroup: {
    backgroundColor: SURFACE_COLOR,
    borderRadius: CARD_BORDER_RADIUS,
    overflow: "hidden",
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  linkRowSeparator: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255, 255, 255, 0.1)",
  },
  linkLabel: {
    flex: 1,
    color: TEXT_PRIMARY,
    fontFamily: "System",
    marginRight: 12,
  },
  attribution: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    textAlign: "center",
    marginTop: 24,
  },
})
