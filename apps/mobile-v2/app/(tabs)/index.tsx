import { View, Text, StyleSheet } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

export default function HomeScreen() {
  const insets = useSafeAreaInsets()

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Text style={styles.title}>Easter</Text>
      <Text style={styles.subtitle}>Loading experience...</Text>
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
    fontSize: 34,
    fontWeight: "bold",
    fontFamily: "System",
  },
  subtitle: {
    color: "#a8a29e",
    fontSize: 17,
    fontFamily: "System",
    marginTop: 8,
  },
})
