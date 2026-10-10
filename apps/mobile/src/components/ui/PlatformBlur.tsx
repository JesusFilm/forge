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
 * Translucent backdrop that blurs on iOS and dims flat on Android — expo-blur is
 * unreliable there, so every surface in this app makes the same split. Note that
 * expo-glass-effect's GlassView is NOT a drop-in here: it renders nothing inside
 * a fading (animated-opacity) layer, and it ignores the opacity prop on iOS.
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
