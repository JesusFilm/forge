import { HomeScreen } from "../../src/components/home/HomeScreen"

// Thin shell: Home renders the curated watch-home composition. Data comes
// from the ported curation config via useWatchHome (inside HomeScreen) — not
// from the Experience context. Experience SDUI lives at /experience/[slug].
export default function HomeTab() {
  return <HomeScreen />
}
