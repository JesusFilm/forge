import { useEffect, useRef } from "react"
import {
  Animated,
  LayoutAnimation,
  Platform,
  Text,
  UIManager,
  type TextStyle,
} from "react-native"

// Enable LayoutAnimation on Android (runs once at import)
if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

// ── Shared LayoutAnimation config ──────────────────────────────────────────

const LAYOUT_ANIMATION_CONFIG = {
  duration: 300,
  update: { type: LayoutAnimation.Types.easeInEaseOut },
  create: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
  },
  delete: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
  },
}

/**
 * Configure the next LayoutAnimation with a consistent easeInEaseOut config.
 */
export function animateLayout(): void {
  LayoutAnimation.configureNext(LAYOUT_ANIMATION_CONFIG)
}

// ── AnimatedChevron ────────────────────────────────────────────────────────

export interface AnimatedChevronProps {
  isExpanded: boolean
  /** Rotation when collapsed (default "0deg"). */
  fromDeg?: string
  /** Rotation when expanded (default "90deg"). */
  toDeg?: string
  /** Glyph to render (default "\u25B8"). */
  glyph?: string
  /** Style applied to the glyph Text. */
  style?: TextStyle
}

export function AnimatedChevron({
  isExpanded,
  fromDeg = "0deg",
  toDeg = "90deg",
  glyph = "\u25B8",
  style,
}: AnimatedChevronProps) {
  const rotation = useRef(new Animated.Value(isExpanded ? 1 : 0)).current

  useEffect(() => {
    Animated.timing(rotation, {
      toValue: isExpanded ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start()
  }, [isExpanded, rotation])

  const rotateInterpolation = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: [fromDeg, toDeg],
  })

  return (
    <Animated.View style={{ transform: [{ rotate: rotateInterpolation }] }}>
      <Text style={style}>{glyph}</Text>
    </Animated.View>
  )
}
