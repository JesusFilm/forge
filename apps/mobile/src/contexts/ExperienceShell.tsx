/**
 * ExperienceShell — wraps the root layout to provide Experience data to the
 * routes that read it (/experience/[slug], /video/[sectionKey],
 * /collection/[sectionKey], Library's active entry).
 *
 * Never blocks rendering: children always mount, and ExperienceProvider is
 * always present. With no selected slug the context is simply empty
 * (experience=null, loading=false) — Home and the tabs do not depend on it.
 *
 * Reads the active slug from ExperienceSelectionProvider. On first launch
 * (no persisted slug) it best-effort resolves the homepage via admin's
 * watchSetting query; a null or failed resolve is silent — the context just
 * stays empty.
 */
import { useEffect, useRef, type ReactNode } from "react"
import { useQuery } from "@apollo/client/react"
import { useExperience } from "../hooks/useExperience"
import { GET_WATCH_SETTING } from "../lib/queries"
import { ExperienceProvider } from "./ExperienceProvider"
import { useExperienceSelection } from "./ExperienceSelectionProvider"

const noopRefetch = () => {}

export function ExperienceShell({ children }: { children: ReactNode }) {
  const { currentSlug, selectExperience, isReady } = useExperienceSelection()

  const needsDefault = isReady && currentSlug === null
  const { data: settingData } = useQuery(GET_WATCH_SETTING, {
    variables: { locale: "en" },
    skip: !needsDefault,
    fetchPolicy: "cache-and-network",
  })

  const resolvedRef = useRef(false)
  useEffect(() => {
    if (!needsDefault) {
      resolvedRef.current = false
      return
    }
    if (resolvedRef.current) return
    const homepage = settingData?.watchSetting?.homepageExperience
    if (homepage?.slug) {
      resolvedRef.current = true
      selectExperience(homepage.slug)
    }
  }, [needsDefault, settingData, selectExperience])

  if (currentSlug === null) {
    return (
      <ExperienceProvider
        experience={null}
        loading={false}
        error={null}
        refetch={noopRefetch}
      >
        {children}
      </ExperienceProvider>
    )
  }

  return (
    <ExperienceShellInner slug={currentSlug}>{children}</ExperienceShellInner>
  )
}

function ExperienceShellInner({
  slug,
  children,
}: {
  slug: string
  children: ReactNode
}) {
  const { experience, loading, error, refetch } = useExperience({ slug })

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
