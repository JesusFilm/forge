import { Tabs } from "expo-router"
import { Platform } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { useTabBarStyle } from "../../src/lib/tabBar"

const ACCENT = "#CB333B"
const MUTED = "#a8a29e"
const BG_COLOR = "#1c1917"

/**
 * Android's tab bar. iOS is shadowed by `_layout.ios.tsx` and its UIKit bar
 * (feat-498) — but this file MUST stay: expo-router resolves the platform
 * sibling by specificity and throws without an extension-less fallback.
 */
export default function TabLayout() {
  const tabBarStyle = useTabBarStyle()

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
          title: "Home",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" size={size} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="watch"
        options={{
          title: "Search",
          headerShown: true,
          headerTitle: "Search",
          headerStyle: { backgroundColor: BG_COLOR },
          headerTintColor: "#f5f5f4",
          headerShadowVisible: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="search" size={size} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: "Library",
          tabBarIcon: ({ color, size }) => (
            <Ionicons
              name="albums-outline"
              size={size}
              color={color as string}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person" size={size} color={color as string} />
          ),
        }}
      />
    </Tabs>
  )
}
