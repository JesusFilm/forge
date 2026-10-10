/**
 * /showcase route — Showcase Mode's reel. Screen options (headerless, background)
 * come from the root Stack in app/_layout.tsx; DatadogRouteTracker names the RUM
 * view "showcase" from the route pattern.
 */
import { ShowcaseScreen } from "../src/components/showcaseMode/ShowcaseScreen"
import { useStartupIntroActive } from "../src/contexts/StartupIntroProvider"

export default function ShowcaseRoute() {
  const introActive = useStartupIntroActive()
  return introActive ? null : <ShowcaseScreen />
}
