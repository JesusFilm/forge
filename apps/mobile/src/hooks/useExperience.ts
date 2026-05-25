import { useMemo, useCallback } from "react"
import { useQuery } from "@apollo/client/react"
import { GET_WATCH_EXPERIENCE } from "../lib/queries"
import {
  normalizeExperience,
  type NormalizedExperience,
} from "../lib/normalizer"

type UseExperienceResult = {
  experience: NormalizedExperience | null
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
  } = useQuery(GET_WATCH_EXPERIENCE, {
    variables: {
      locale,
      slug,
    },
    fetchPolicy: "cache-and-network",
  })

  const experience = useMemo<NormalizedExperience | null>(() => {
    const experienceBySlug = data?.experienceBySlug
    if (!experienceBySlug) return null
    return normalizeExperience(
      experienceBySlug as unknown as Record<string, unknown>,
    )
  }, [data])

  const refetch = useCallback(() => {
    apolloRefetch()
  }, [apolloRefetch])

  return {
    experience,
    loading: loading && experience === null, // Only show loading on first load, not background refetch
    error: error?.message ?? null,
    refetch,
  }
}
