import { StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { TEXT_SECONDARY } from "../../lib/color"
import { layout, text } from "../../styles/shared"

interface PlaceholderScreenProps {
  title: string
}

export function PlaceholderScreen({ title }: PlaceholderScreenProps) {
  const insets = useSafeAreaInsets()
  return (
    <View style={[layout.centered, { paddingTop: insets.top + 16 }]}>
      <Text style={text.errorTitle}>{title}</Text>
      <Text style={styles.subtitle}>Coming soon</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  subtitle: {
    color: TEXT_SECONDARY,
    fontSize: 15,
    fontFamily: "System",
  },
})
