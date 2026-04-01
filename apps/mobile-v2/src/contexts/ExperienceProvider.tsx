import { createContext, useContext, useMemo, type ReactNode } from "react"
import type { NormalizedBlock, NormalizedExperience } from "../lib/normalizer"

type ExperienceContextValue = {
  experience: NormalizedExperience | null
  loading: boolean
  error: string | null
  /** O(1) lookup of a section by its sectionKey */
  getSectionByKey: (key: string) => NormalizedBlock | undefined
  refetch: () => void
}

const ExperienceContext = createContext<ExperienceContextValue>({
  experience: null,
  loading: true,
  error: null,
  getSectionByKey: () => undefined,
  refetch: () => {},
})

export function ExperienceProvider({
  children,
  experience,
  loading,
  error,
  refetch,
}: {
  children: ReactNode
  experience: NormalizedExperience | null
  loading: boolean
  error: string | null
  refetch: () => void
}) {
  // Build a Map keyed by sectionKey for O(1) lookups from the detail screen
  const sectionMap = useMemo(() => {
    const map = new Map<string, NormalizedBlock>()
    if (!experience) return map

    function indexBlock(block: NormalizedBlock) {
      const key =
        (block.sectionKey as string | undefined) ??
        (block.id as string | undefined)
      if (key) map.set(key, block)

      // Index nested content in sectionWrapper
      if (
        block.kind === "sectionWrapper" &&
        Array.isArray(block.sectionContent)
      ) {
        for (const child of block.sectionContent as NormalizedBlock[]) {
          indexBlock(child)
        }
      }

      // Index nested content in container slots
      if (block.kind === "container" && Array.isArray(block.slots)) {
        for (const slot of block.slots as Array<{
          slotContent?: NormalizedBlock[]
        }>) {
          if (Array.isArray(slot.slotContent)) {
            for (const child of slot.slotContent) {
              indexBlock(child)
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

  return (
    <ExperienceContext.Provider
      value={{ experience, loading, error, getSectionByKey, refetch }}
    >
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
