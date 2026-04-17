import { Tabs } from "expo-router"
import { Platform } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

const ACCENT = "#CB333B"
const MUTED = "#a8a29e"
const BG_COLOR = "#1c1917"

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACCENT,
        tabBarInactiveTintColor: MUTED,
        tabBarStyle: {
          backgroundColor: "#1c1917",
          borderTopColor: "transparent",
        },
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
          tabBarButtonTestID: "tab-home",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="watch"
        options={{
          title: "Discover",
          tabBarButtonTestID: "tab-discover",
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
          tabBarButtonTestID: "tab-library",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="albums-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarButtonTestID: "tab-profile",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  )
}
