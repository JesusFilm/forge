// SYNC: block-indexing/scroll surface stays in sync with apps/mobile's provider;
// `videoByCoreId` is a deliberate TV-only field (see experienceHydration.ts), not drift.

import { createContext, useContext, useMemo, type ReactNode } from "react"
import type { NormalizedBlock, NormalizedExperience } from "../lib/normalizer"
import type { HydratedVideo } from "../lib/experienceHydration"

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
  /** coreId → video hydrated via GET_WATCH_HOME_VIDEOS (MediaCollection cards). */
  videoByCoreId: Map<string, HydratedVideo>
  refetch: () => void
}

// Stable empty default so the prop fallback never churns the useMemo identity.
const EMPTY_VIDEO_MAP: Map<string, HydratedVideo> = new Map()

const ExperienceContext = createContext<ExperienceContextValue>({
  experience: null,
  loading: true,
  error: null,
  scrollToSection: () => {},
  registerNestedLayout: () => {},
  videoByCoreId: EMPTY_VIDEO_MAP,
  refetch: () => {},
})

export function ExperienceProvider({
  children,
  experience,
  loading,
  error,
  scrollToSection = () => {},
  registerNestedLayout = () => {},
  videoByCoreId = EMPTY_VIDEO_MAP,
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
  videoByCoreId?: Map<string, HydratedVideo>
  refetch: () => void
}) {
  const contextValue = useMemo(
    () => ({
      experience,
      loading,
      error,
      scrollToSection,
      registerNestedLayout,
      videoByCoreId,
      refetch,
    }),
    [
      experience,
      loading,
      error,
      scrollToSection,
      registerNestedLayout,
      videoByCoreId,
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
