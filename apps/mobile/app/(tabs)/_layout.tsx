import { Tabs, useRouter } from "expo-router"
import { Platform, Pressable } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

const ACCENT = "#CB333B"
const MUTED = "#a8a29e"
const BG_COLOR = "#1c1917"

export default function TabLayout() {
  const router = useRouter()

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
          headerRight: () => (
            <Pressable
              onPress={() => router.push("/search")}
              accessibilityRole="button"
              accessibilityLabel="Search"
              hitSlop={12}
              style={{ marginRight: 8 }}
            >
              <Ionicons name="search" size={22} color={ACCENT} />
            </Pressable>
          ),
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
