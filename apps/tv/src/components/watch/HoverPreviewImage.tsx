import { useEffect, useRef } from "react"
import { Animated, StyleSheet } from "react-native"
import { Image } from "expo-image"

// Verified on tvOS (U1 spike): expo-image animates a Mux animated.webp; no
// decode slot (an image texture, not an AVPlayer), so it never contends with the
// hero VideoBackdrop or the fullscreen VideoPlayer (KTD1/R7).

const FADE_MS = 260

type Props = {
  // The Mux animated-preview URL from useHoverPreview, or null when inactive.
  previewUrl: string | null
  // Match the poster's fit/position so the crossfade doesn't jump (KTD6).
  contentFit?: React.ComponentProps<typeof Image>["contentFit"]
  contentPosition?: React.ComponentProps<typeof Image>["contentPosition"]
}

/**
 * Absolute-fill crossfade overlay for the hover-preview. Renders nothing when
 * inactive; otherwise fades the animated webp in over the poster only once it has
 * loaded (poster shows through until then — no half-loaded flash). Decorative and
 * non-focusable. The parent stacks it above the poster/scrim, below ring + chip.
 */
export function HoverPreviewImage({
  previewUrl,
  contentFit = "cover",
  contentPosition,
}: Props) {
  const opacity = useRef(new Animated.Value(0)).current

  // A new (or cleared) url starts hidden and fades in on its own onLoad.
  useEffect(() => {
    opacity.setValue(0)
  }, [previewUrl, opacity])

  if (previewUrl == null) return null

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { opacity }]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Image
        source={{ uri: previewUrl }}
        style={StyleSheet.absoluteFill}
        contentFit={contentFit}
        contentPosition={contentPosition}
        autoplay
        onLoad={() =>
          Animated.timing(opacity, {
            toValue: 1,
            duration: FADE_MS,
            useNativeDriver: true,
          }).start()
        }
      />
    </Animated.View>
  )
}
