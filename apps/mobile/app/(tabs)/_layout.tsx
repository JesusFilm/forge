import { Tabs } from "expo-router"
import { Platform, type ViewStyle } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

const ACCENT = "#CB333B"
const MUTED = "#a8a29e"
const BG_COLOR = "#1c1917"

// Shared so the Library screen can RESTORE this exact style after hiding the
// tab bar during selection — restoring to `undefined` falls back to RN's
// default (light) bar, not the navigator's dark one (that was the bug).
export const TAB_BAR_STYLE: ViewStyle = {
  backgroundColor: BG_COLOR,
  borderTopColor: "transparent",
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACCENT,
        tabBarInactiveTintColor: MUTED,
        tabBarStyle: TAB_BAR_STYLE,
        tabBarLabelStyle: {
          fontSize: Platform.select({ ios: 10, android: 12 }),
          fontFamily: "System",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" size={size} color={color} />
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
            <Ionicons name="compass" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: "Library",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="albums-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  )
}
