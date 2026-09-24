import { useRouter } from "expo-router"
import { StyleSheet, View } from "react-native"

import { scale } from "../../lib/scale"
import { SecondaryPill } from "../watch/DetailsActionRow"

export function FeedbackUtilityHeader({ screen }: { screen: string }) {
  const router = useRouter()
  if (!process.env.EXPO_PUBLIC_TV_FEEDBACK_URL) return null
  return (
    <View style={styles.row}>
      <SecondaryPill
        icon="chatbox-ellipses-outline"
        label="Send feedback"
        onPress={() =>
          router.push({ pathname: "/feedback", params: { screen } })
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    minHeight: scale(80),
    paddingHorizontal: scale(80),
    paddingTop: scale(12),
    alignItems: "flex-end",
    justifyContent: "center",
  },
})
