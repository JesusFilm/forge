import { ScrollView, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { AccountSection } from "../../src/components/profile/AccountSection"
import { ProfileLinksSection } from "../../src/components/profile/ProfileLinksSection"
import { useTabBarClearance } from "../../src/lib/tabBar"
import { layout } from "../../src/styles/shared"

export default function ProfileScreen() {
  const insets = useSafeAreaInsets()
  const tabBarClearance = useTabBarClearance()

  return (
    <View style={[layout.screenContainer, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: 16,
          paddingBottom: 24 + tabBarClearance,
        }}
        scrollIndicatorInsets={{ bottom: tabBarClearance }}
      >
        <AccountSection />
        <ProfileLinksSection />
      </ScrollView>
    </View>
  )
}
