import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"

const STORAGE_KEY = "selectedExperienceSlug"

type ExperienceSelectionContextValue = {
  /** The currently selected slug, or null if not yet resolved */
  currentSlug: string | null
  /** Set the active experience and persist the choice */
  selectExperience: (slug: string) => void
  /** False until the persisted slug has been read from AsyncStorage */
  isReady: boolean
}

const ExperienceSelectionContext =
  createContext<ExperienceSelectionContextValue | null>(null)

export function ExperienceSelectionProvider({
  children,
}: {
  children: ReactNode
}) {
  const [currentSlug, setCurrentSlug] = useState<string | null>(null)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored) setCurrentSlug(stored)
      })
      .catch(() => {
        // Treat read failure as first launch
      })
      .finally(() => {
        setIsReady(true)
      })
  }, [])

  const selectExperience = useCallback((slug: string) => {
    setCurrentSlug(slug)
    AsyncStorage.setItem(STORAGE_KEY, slug).catch(() => {
      // Best-effort persistence — app still works if write fails
    })
  }, [])

  return (
    <ExperienceSelectionContext.Provider
      value={{ currentSlug, selectExperience, isReady }}
    >
      {children}
    </ExperienceSelectionContext.Provider>
  )
}

export function useExperienceSelection() {
  const ctx = useContext(ExperienceSelectionContext)
  if (!ctx) {
    throw new Error(
      "useExperienceSelection must be used within ExperienceSelectionProvider",
    )
  }
  return ctx
}
