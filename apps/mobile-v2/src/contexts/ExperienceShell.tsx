/**
 * ExperienceShell — wraps the root layout to provide Experience data
 * to both (tabs) and video/[sectionKey] routes.
 *
 * Fetches the Easter experience on mount, normalizes it, and provides
 * it via ExperienceProvider context.
 */
import type { ReactNode } from "react"
import { useExperience } from "../hooks/useExperience"
import { ExperienceProvider } from "./ExperienceProvider"

const DEFAULT_SLUG = "easter"

export function ExperienceShell({ children }: { children: ReactNode }) {
  const { experience, loading, error, refetch } = useExperience({
    slug: DEFAULT_SLUG,
  })

  return (
    <ExperienceProvider
      experience={experience}
      loading={loading}
      error={error}
      refetch={refetch}
    >
      {children}
    </ExperienceProvider>
  )
}
