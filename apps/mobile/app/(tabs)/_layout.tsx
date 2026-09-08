import { Tabs } from "expo-router"
import { Platform } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { TabBarBackground } from "../../src/components/ui/TabBarBackground"
import { tabBarActiveTint, useTabBarStyle } from "../../src/lib/tabBar"

const MUTED = "#a8a29e"
const BG_COLOR = "#1c1917"

export default function TabLayout() {
  const tabBarStyle = useTabBarStyle()

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: tabBarActiveTint(),
        tabBarInactiveTintColor: MUTED,
        tabBarStyle,
        // Returned as an ELEMENT, not passed as the component: the bar calls
        // tabBarBackground(), so hooks would otherwise land in ITS render.
        tabBarBackground: () => <TabBarBackground />,
        // A floating pill glued to the keyboard's top edge reads as a bug.
        // Unset on Android, exactly as today.
        tabBarHideOnKeyboard: Platform.OS === "ios" ? true : undefined,
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
          title: "Discover",
          headerShown: true,
          headerTitle: "Discover",
          headerStyle: { backgroundColor: BG_COLOR },
          headerTintColor: "#f5f5f4",
          headerShadowVisible: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="compass" size={size} color={color as string} />
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
