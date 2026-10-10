import { createContext, useContext, useMemo, type ReactNode } from "react"
import type { WatchExperience, AdminBlock } from "../lib/queries"
import {
  useVideoThumbnails,
  type VideoMetaMap,
} from "../hooks/useVideoThumbnails"

type ExperienceContextValue = {
  experience: WatchExperience | null
  loading: boolean
  error: string | null
  getSectionByKey: (key: string) => AdminBlock | undefined
  getVideoThumbnail: (videoId: string) => string | null
  getVideoTitle: (videoId: string) => string | null
  refetch: () => void
}

const ExperienceContext = createContext<ExperienceContextValue>({
  experience: null,
  loading: true,
  error: null,
  getSectionByKey: () => undefined,
  getVideoThumbnail: () => null,
  getVideoTitle: () => null,
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
  experience: WatchExperience | null
  loading: boolean
  error: string | null
  refetch: () => void
}) {
  const videoMeta: VideoMetaMap = useVideoThumbnails(experience)

  const sectionMap = useMemo(() => {
    const map = new Map<string, AdminBlock>()
    if (!experience) return map

    function indexBlock(block: AdminBlock, siblingContent?: AdminBlock[]) {
      const key =
        "sectionKey" in block
          ? (block.sectionKey as string | undefined)
          : undefined
      if (key) {
        map.set(key, siblingContent ? { ...block, siblingContent } : block)
      }

      if (
        block.__typename === "SectionBlock" &&
        "sectionContent" in block &&
        Array.isArray(block.sectionContent)
      ) {
        const children = block.sectionContent as AdminBlock[]
        for (const child of children) {
          indexBlock(child, children)
        }
      }

      if (
        block.__typename === "ContainerBlock" &&
        "content" in block &&
        Array.isArray(block.content)
      ) {
        for (const item of block.content as AdminBlock[]) {
          if (item.__typename === "ContainerSlotBlock") continue
          indexBlock(item, siblingContent)
        }
      }
    }

    for (const block of experience.blocks ?? []) {
      if (block) indexBlock(block as AdminBlock)
    }
    return map
  }, [experience])

  const getSectionByKey = useMemo(
    () => (key: string) => sectionMap.get(key),
    [sectionMap],
  )

  const getVideoThumbnail = useMemo(
    () => (videoId: string) => videoMeta.get(videoId)?.thumbnail ?? null,
    [videoMeta],
  )

  const getVideoTitle = useMemo(
    () => (videoId: string) => videoMeta.get(videoId)?.title ?? null,
    [videoMeta],
  )

  const contextValue = useMemo(
    () => ({
      experience,
      loading,
      error,
      getSectionByKey,
      getVideoThumbnail,
      getVideoTitle,
      refetch,
    }),
    [
      experience,
      loading,
      error,
      getSectionByKey,
      getVideoThumbnail,
      getVideoTitle,
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

export function useSectionByKey(key: string): AdminBlock | undefined {
  const { getSectionByKey } = useExperienceContext()
  return getSectionByKey(key)
}

export function useVideoThumbnail(
  videoId: string | null | undefined,
): string | null {
  const { getVideoThumbnail } = useExperienceContext()
  if (!videoId) return null
  return getVideoThumbnail(videoId)
}
