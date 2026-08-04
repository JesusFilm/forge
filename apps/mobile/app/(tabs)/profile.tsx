import { ScrollView, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { AccountSection } from "../../src/components/profile/AccountSection"
import { ProfileLinksSection } from "../../src/components/profile/ProfileLinksSection"
import { useTypography } from "../../src/hooks/useTypography"
import { TEXT_PRIMARY } from "../../src/lib/color"
import { layout } from "../../src/styles/shared"

export default function ProfileScreen() {
  const insets = useSafeAreaInsets()
  const typography = useTypography()

  return (
    <View style={[layout.screenContainer, { paddingTop: insets.top }]}>
      <Text style={[styles.header, typography.heading]}>Profile</Text>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <AccountSection />
        <ProfileLinksSection />
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  scrollContent: {
    paddingBottom: 24,
  },
})
