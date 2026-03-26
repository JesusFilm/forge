import { createContext, useContext } from "react"

/**
 * When true, child section renderers are inside a FixedHeroLayout's
 * translucent scroll area. They should skip their own opaque backgrounds
 * so the hero video bleeds through.
 */
export const HeroSectionContext = createContext<boolean>(false)

export function useIsInsideHero(): boolean {
  return useContext(HeroSectionContext)
}
