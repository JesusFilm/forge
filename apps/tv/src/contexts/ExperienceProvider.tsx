// SYNC: keep in sync with apps/mobile/src/contexts/ExperienceProvider.tsx

import { createContext, useContext, useMemo, type ReactNode } from "react"
import type { NormalizedBlock, NormalizedExperience } from "../lib/normalizer"

type ExperienceContextValue = {
  experience: NormalizedExperience | null
  loading: boolean
  error: string | null
  /** O(1) lookup of a section by its sectionKey */
  getSectionByKey: (key: string) => NormalizedBlock | undefined
  /** Scroll the experience feed to the section matching this sectionKey */
  scrollToSection: (key: string) => void
  refetch: () => void
}

const ExperienceContext = createContext<ExperienceContextValue>({
  experience: null,
  loading: true,
  error: null,
  getSectionByKey: () => undefined,
  scrollToSection: () => {},
  refetch: () => {},
})

export function ExperienceProvider({
  children,
  experience,
  loading,
  error,
  scrollToSection = () => {},
  refetch,
}: {
  children: ReactNode
  experience: NormalizedExperience | null
  loading: boolean
  error: string | null
  scrollToSection?: (key: string) => void
  refetch: () => void
}) {
  // Build a Map keyed by sectionKey for O(1) lookups from the detail screen
  const sectionMap = useMemo(() => {
    const map = new Map<string, NormalizedBlock>()
    if (!experience) return map

    function indexBlock(
      block: NormalizedBlock,
      siblingContent?: NormalizedBlock[],
    ) {
      const key =
        (block.sectionKey as string | undefined) ??
        (block.id as string | undefined)
      if (key) {
        map.set(key, siblingContent ? { ...block, siblingContent } : block)
      }

      // Index nested content in sectionWrapper
      if (
        block.kind === "sectionWrapper" &&
        Array.isArray(block.sectionContent)
      ) {
        const children = block.sectionContent as NormalizedBlock[]
        for (const child of children) {
          indexBlock(child, children)
        }
      }

      // Index nested content in container slots.
      // Containers are structural wrappers — their children see the
      // enclosing sectionWrapper's content, not the slot's own content.
      if (block.kind === "container" && Array.isArray(block.slots)) {
        for (const slot of block.slots as Array<{
          slotContent?: NormalizedBlock[]
        }>) {
          if (Array.isArray(slot.slotContent)) {
            for (const child of slot.slotContent) {
              indexBlock(child, siblingContent)
            }
          }
        }
      }
    }

    for (const section of experience.sections) {
      indexBlock(section)
    }
    return map
  }, [experience])

  const getSectionByKey = useMemo(
    () => (key: string) => sectionMap.get(key),
    [sectionMap],
  )

  const contextValue = useMemo(
    () => ({
      experience,
      loading,
      error,
      getSectionByKey,
      scrollToSection,
      refetch,
    }),
    [experience, loading, error, getSectionByKey, scrollToSection, refetch],
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

export function useSectionByKey(key: string): NormalizedBlock | undefined {
  const { getSectionByKey } = useExperienceContext()
  return getSectionByKey(key)
}
