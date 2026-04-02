import { Tabs } from "expo-router"
import { Platform } from "react-native"

const ACCENT = "#CB333B"
const MUTED = "#a8a29e"

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
          tabBarIcon: ({ color: _color, size: _size }) => null, // TODO: Add icons in Phase 5
        }}
      />
    </Tabs>
  )
}
