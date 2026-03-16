import { createContext, useContext } from "react"

export interface SectionNavValue {
  scrollToSection: (sectionKey: string) => void
  registerSection: (sectionKey: string, y: number) => void
}

const noop = () => {}

export const SectionNavContext = createContext<SectionNavValue>({
  scrollToSection: noop,
  registerSection: noop,
})

export function useSectionNav(): SectionNavValue {
  return useContext(SectionNavContext)
}
