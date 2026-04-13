import { useState, type ReactNode } from "react"
import { Pressable, StyleSheet, type ViewStyle } from "react-native"

type FocusableCardProps = {
  onPress: () => void
  onFocus?: () => void
  onBlur?: () => void
  hasTVPreferredFocus?: boolean
  style?: ViewStyle
  children: ReactNode
}

export function FocusableCard({
  onPress,
  onFocus,
  onBlur,
  hasTVPreferredFocus,
  style,
  children,
}: FocusableCardProps) {
  const [isFocused, setIsFocused] = useState(false)

  return (
    <Pressable
      onPress={onPress}
      onFocus={() => {
        setIsFocused(true)
        onFocus?.()
      }}
      onBlur={() => {
        setIsFocused(false)
        onBlur?.()
      }}
      hasTVPreferredFocus={hasTVPreferredFocus}
      style={[styles.card, isFocused && styles.cardFocused, style]}
    >
      {children}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#2D2927",
    borderRadius: 16,
  },
  cardFocused: {
    transform: [{ scale: 1.05 }],
    shadowColor: "#CB333B",
    shadowRadius: 20,
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 0 },
  },
})
