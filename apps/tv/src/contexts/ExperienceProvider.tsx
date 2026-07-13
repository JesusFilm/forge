// SYNC: keep in sync with apps/mobile/src/contexts/ExperienceProvider.tsx

import { createContext, useContext, useMemo, type ReactNode } from "react"
import type { NormalizedBlock, NormalizedExperience } from "../lib/normalizer"

type ExperienceContextValue = {
  experience: NormalizedExperience | null
  loading: boolean
  error: string | null
  /** Scroll the experience feed to the section matching this sectionKey */
  scrollToSection: (key: string) => void
  /** Register Y position for a nested block (parentY + childOffsetY) */
  registerNestedLayout: (
    block: NormalizedBlock,
    parentIndex: number,
    absoluteY: number,
  ) => void
  refetch: () => void
}

const ExperienceContext = createContext<ExperienceContextValue>({
  experience: null,
  loading: true,
  error: null,
  scrollToSection: () => {},
  registerNestedLayout: () => {},
  refetch: () => {},
})

export function ExperienceProvider({
  children,
  experience,
  loading,
  error,
  scrollToSection = () => {},
  registerNestedLayout = () => {},
  refetch,
}: {
  children: ReactNode
  experience: NormalizedExperience | null
  loading: boolean
  error: string | null
  scrollToSection?: (key: string) => void
  registerNestedLayout?: (
    block: NormalizedBlock,
    parentIndex: number,
    absoluteY: number,
  ) => void
  refetch: () => void
}) {
  const contextValue = useMemo(
    () => ({
      experience,
      loading,
      error,
      scrollToSection,
      registerNestedLayout,
      refetch,
    }),
    [
      experience,
      loading,
      error,
      scrollToSection,
      registerNestedLayout,
      refetch,
    ],
  )

  return (
    <ExperienceContext.Provider value={contextValue}>
      {children}
    </ExperienceContext.Provider>
  )
}

export function useExperienceContext() {
  return useContext(ExperienceContext)
}
