import { Tabs } from "expo-router"
import { Platform } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { isExploreAvailable } from "../../src/lib/explore/availability"
import { useTabBarStyle, useTabLabels } from "../../src/lib/tabBar"

const ACCENT = "#CB333B"
const MUTED = "#a8a29e"

/**
 * Android's tab bar. iOS is shadowed by `_layout.ios.tsx` and its UIKit bar
 * (feat-500) — but this file MUST stay: expo-router resolves the platform
 * sibling by specificity and throws without an extension-less fallback.
 */
export default function TabLayout() {
  const tabBarStyle = useTabBarStyle()
  const labels = useTabLabels()

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACCENT,
        tabBarInactiveTintColor: MUTED,
        tabBarStyle,
        tabBarLabelStyle: {
          fontSize: Platform.select({ ios: 10, android: 12 }),
          fontFamily: "System",
        },
      }}
    >
      {/* `color as string`: expo-router hands ColorValue, but pnpm peer-instancing
          resolves this Ionicons' props to string-only color. Values are theme strings. */}
      <Tabs.Screen
        name="index"
        options={{
          title: labels.index,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" size={size} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: labels.explore,
          // KTD16: `null` hides the button. The route stays reachable by URL,
          // so explore.tsx checks the gate as well.
          href: isExploreAvailable() ? undefined : null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="play-circle" size={size} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="watch"
        options={{
          title: labels.watch,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="search" size={size} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="bible"
        options={{
          title: labels.bible,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="book" size={size} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: labels.profile,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person" size={size} color={color as string} />
          ),
        }}
      />
    </Tabs>
  )
}
