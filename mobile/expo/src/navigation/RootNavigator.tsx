import { createNativeStackNavigator } from "@react-navigation/native-stack"

import { ExperienceScreen } from "../screens/ExperienceScreen"
import { WatchHomeScreen } from "../screens/WatchHomeScreen"

export type RootStackParamList = {
  WatchHome: undefined
  Experience: { slug: string; locale?: string }
}

const Stack = createNativeStackNavigator<RootStackParamList>()

export function RootNavigator() {
  return (
    <Stack.Navigator initialRouteName="WatchHome">
      <Stack.Screen
        name="WatchHome"
        component={WatchHomeScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Experience"
        component={ExperienceScreen}
        options={({ route }) => ({
          title: route.params.slug,
          headerBackTitle: "Home",
        })}
      />
    </Stack.Navigator>
  )
}
