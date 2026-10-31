import { Redirect } from "expo-router"
import { AnimationSettingsScreen } from "../../src/components/settings/AnimationSettingsScreen"
import { ANIMATION_SETTINGS_ENABLED } from "../../src/lib/logoAnimations"

export default function AnimationsRoute() {
  return ANIMATION_SETTINGS_ENABLED ? (
    <AnimationSettingsScreen />
  ) : (
    <Redirect href="/settings" />
  )
}
