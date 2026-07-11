import { createContext, useContext } from "react"

/**
 * TV-only: whether the Experience hero is substantially on-screen. Drives the
 * hero's scroll-off pause (R10). Kept out of the mobile-synced ExperienceProvider
 * on purpose. Defaults to true, so a hero with no provider above it is treated as
 * visible (safe default).
 */
const HeroVisibilityContext = createContext<boolean>(true)

export const HeroVisibilityProvider = HeroVisibilityContext.Provider

/** Whether the hero is currently on-screen (true when no provider is present). */
export function useHeroOnScreen(): boolean {
  return useContext(HeroVisibilityContext)
}
