import { useMemo, useCallback } from "react"
import { useQuery } from "@apollo/client/react"
import { GET_EXPERIENCE_BY_SLUG, type WatchExperience } from "../lib/queries"

type UseExperienceResult = {
  experience: WatchExperience | null
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useExperience({
  slug,
  locale = "en",
}: {
  slug: string
  locale?: string
}): UseExperienceResult {
  const {
    data,
    loading,
    error,
    refetch: apolloRefetch,
  } = useQuery(GET_EXPERIENCE_BY_SLUG, {
    variables: { locale, slug },
    fetchPolicy: "cache-and-network",
  })

  const experience = useMemo<WatchExperience | null>(() => {
    return data?.experienceBySlug ?? null
  }, [data])

  const refetch = useCallback(() => {
    apolloRefetch()
  }, [apolloRefetch])

  return {
    experience,
    loading: loading && experience === null,
    error: error?.message ?? null,
    refetch,
  }
}
