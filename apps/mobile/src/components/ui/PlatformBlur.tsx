import type { ReactNode } from "react"
import { Platform, View, type StyleProp, type ViewStyle } from "react-native"
import { BlurView } from "expo-blur"

type PlatformBlurProps = {
  style?: StyleProp<ViewStyle>
  /** iOS blur strength. Ignored on Android, which takes the flat dim instead. */
  intensity?: number
  tint?: "dark" | "light" | "default"
  /** Android's stand-in fill. Callers pass the colour their surface already used. */
  androidDim?: string
  children?: ReactNode
}

/**
 * A blur on iOS and a flat dim on Android, where expo-blur is unreliable.
 * GlassView draws nothing reliably inside a fading layer, so `GlassSurface`
 * keeps glass out of the fade, dissolves it with the 'none' style, or uses this.
 */
export function PlatformBlur({
  style,
  intensity = 50,
  tint = "dark",
  androidDim = "rgba(0, 0, 0, 0.6)",
  children,
}: PlatformBlurProps) {
  if (Platform.OS === "ios") {
    return (
      <BlurView intensity={intensity} tint={tint} style={style}>
        {children}
      </BlurView>
    )
  }
  return (
    <View style={[style, { backgroundColor: androidDim }]}>{children}</View>
  )
}
