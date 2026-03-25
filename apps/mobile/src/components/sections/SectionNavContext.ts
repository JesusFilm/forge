import { createContext, useContext } from "react"
import type { View } from "react-native"

export interface SectionNavValue {
  scrollToSection: (sectionKey: string) => void
  registerSectionRef: (sectionKey: string, ref: View | null) => void
}

const noop = () => {}

export const SectionNavContext = createContext<SectionNavValue>({
  scrollToSection: noop,
  registerSectionRef: noop,
})

export function useSectionNav(): SectionNavValue {
  return useContext(SectionNavContext)
}
