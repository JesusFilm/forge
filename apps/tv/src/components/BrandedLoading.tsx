import { StyleSheet, View } from "react-native"
import { useWatchPreferences } from "../contexts/WatchPreferencesProvider"
import { LogoAnimation } from "./LogoAnimation"

export function BrandedLoading({ label = "Loading Home" }: { label?: string }) {
  const { loadingAnimationId } = useWatchPreferences()
  return (
    <View
      style={styles.root}
      pointerEvents="none"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
    >
      <LogoAnimation id={loadingAnimationId} />
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#161311",
    alignItems: "center",
    justifyContent: "center",
  },
})
