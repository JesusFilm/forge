import { StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

interface PlaceholderScreenProps {
  title: string
}

export function PlaceholderScreen({ title }: PlaceholderScreenProps) {
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>Coming soon</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1c1917",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    color: "#f5f5f4",
    fontSize: 22,
    fontWeight: "bold",
    fontFamily: "System",
    marginBottom: 8,
  },
  subtitle: {
    color: "#a8a29e",
    fontSize: 15,
    fontFamily: "System",
  },
})
