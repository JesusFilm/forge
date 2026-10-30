import { Slot } from "expo-router"

/**
 * Android and the default: no new navigator. iOS renders `_layout.ios.tsx`.
 * This file MUST stay: expo-router throws when a platform file has no
 * extension-less sibling.
 */
export default function DiscoverLayout() {
  return <Slot />
}
