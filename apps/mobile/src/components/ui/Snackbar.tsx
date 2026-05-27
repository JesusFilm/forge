import { useCallback, useEffect, useRef, useState } from "react"
import { Animated, Pressable, StyleSheet, Text } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Ionicons from "@expo/vector-icons/Ionicons"

import { useTypography } from "../../hooks/useTypography"
import { TEXT_PRIMARY, TEXT_SECONDARY } from "../../lib/color"

type SnackbarProps = {
  message: string
  visible: boolean
  onDismiss: () => void
  duration?: number
}

export function Snackbar({
  message,
  visible,
  onDismiss,
  duration = 3000,
}: SnackbarProps) {
  const insets = useSafeAreaInsets()
  const typography = useTypography()
  const translateY = useRef(new Animated.Value(100)).current
  const opacity = useRef(new Animated.Value(0)).current
  const [mounted, setMounted] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (visible) {
      setMounted(true)
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          tension: 80,
          friction: 10,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start()
      timer.current = setTimeout(() => {
        dismiss()
      }, duration)
    }
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [visible])

  const dismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 100,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        setMounted(false)
        onDismiss()
      }
    })
  }, [translateY, opacity, onDismiss])

  if (!mounted) return null

  return (
    <Animated.View
      style={[
        styles.container,
        {
          bottom: insets.bottom + 16,
          transform: [{ translateY }],
          opacity,
        },
      ]}
    >
      <Ionicons name="checkmark-circle" size={22} color="#4ade80" />
      <Text style={[styles.message, typography.body]}>{message}</Text>
      <Pressable onPress={dismiss} hitSlop={8}>
        <Ionicons name="close" size={18} color={TEXT_SECONDARY} />
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#292524",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  message: {
    flex: 1,
    color: TEXT_PRIMARY,
    fontFamily: "System",
  },
})
