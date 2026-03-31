import { createContext, useContext } from "react"

interface LazySectionState {
  /** True when the section overlaps the visible viewport (0 buffer). */
  visible: boolean
}

export const LazySectionContext = createContext<LazySectionState>({
  visible: true,
})

/** Returns whether the enclosing LazySection is currently in the viewport. */
export function useSectionVisible(): boolean {
  return useContext(LazySectionContext).visible
}
