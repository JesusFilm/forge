import { View, Text, StyleSheet } from "react-native"
import { useLocalSearchParams } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

export default function VideoDetailScreen() {
  const { sectionKey } = useLocalSearchParams<{ sectionKey: string }>()
  const insets = useSafeAreaInsets()

  return (
    <View style={[styles.container, { paddingTop: insets.top + 44 }]}>
      <Text style={styles.title}>Video Detail</Text>
      <Text style={styles.subtitle}>Section: {sectionKey}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1c1917",
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    color: "#f5f5f4",
    fontSize: 22,
    fontWeight: "bold",
    fontFamily: "System",
  },
  subtitle: {
    color: "#a8a29e",
    fontSize: 15,
    fontFamily: "System",
    marginTop: 8,
  },
})
