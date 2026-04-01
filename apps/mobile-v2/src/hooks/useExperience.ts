import { useState, useEffect, useCallback } from "react"
import { useApolloClient } from "@apollo/client/react"
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

/**
 * Fetch an Experience by slug, normalize the blocks, and return typed sections.
 * Uses cache-first with background refetch for instant cold-start rendering.
 */
export function useExperience({
  slug,
  locale = "en",
}: {
  slug: string
  locale?: string
}): UseExperienceResult {
  const client = useApolloClient()
  const [experience, setExperience] = useState<NormalizedExperience | null>(
    null,
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchExperience = useCallback(
    async (fetchPolicy: "cache-first" | "network-only" = "cache-first") => {
      try {
        setLoading(true)
        setError(null)

        const result = await client.query({
          query: GET_WATCH_EXPERIENCE,
          variables: {
            locale,
            filters: { slug: { eq: slug } },
          },
          fetchPolicy,
        })

        const experiences = result.data?.experiences
        if (!experiences || experiences.length === 0) {
          setError("Experience not found")
          setExperience(null)
          return
        }

        const normalized = normalizeExperience(
          experiences[0] as unknown as Record<string, unknown>,
        )
        setExperience(normalized)
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to load experience"
        setError(message)
      } finally {
        setLoading(false)
      }
    },
    [client, slug, locale],
  )

  useEffect(() => {
    let cancelled = false

    // Fetch from cache first (instant if persisted cache has data)
    fetchExperience("cache-first").then(() => {
      // Background refetch for fresh data
      if (!cancelled) {
        fetchExperience("network-only")
      }
    })

    return () => {
      cancelled = true
    }
  }, [fetchExperience])

  const refetch = useCallback(() => {
    fetchExperience("network-only")
  }, [fetchExperience])

  return { experience, loading, error, refetch }
}
