import { useMemo, useCallback, useRef } from "react"
import { useQuery } from "@apollo/client/react"
import { GET_EXPERIENCE_BY_SLUG, type WatchExperience } from "../lib/queries"
import { localeQueryVariables } from "../lib/videoText"
import { useUiTag } from "./useUiTag"

type UseExperienceResult = {
  experience: WatchExperience | null
  loading: boolean
  error: string | null
  refetch: () => void
}

/** The Experience in the UI locale, else its `en` variant (KTD10). KTD16: the
 *  slug's last good Experience stays until the new locale resolves, so an
 *  Experience media route keeps its section and never unmounts its player. */
export function useExperience({ slug }: { slug: string }): UseExperienceResult {
  const catalogTag = useUiTag()
  const {
    data,
    loading,
    error,
    refetch: apolloRefetch,
  } = useQuery(GET_EXPERIENCE_BY_SLUG, {
    variables: { slug, ...localeQueryVariables(catalogTag) },
    fetchPolicy: "cache-and-network",
  })

  // undefined = no answer yet for these variables; null = Admin has none.
  const resolved = useMemo<WatchExperience | null | undefined>(() => {
    if (data == null) return undefined
    return data.experienceBySlug ?? data.englishExperience ?? null
  }, [data])

  // A cache keyed by slug, filled during render so the swap has no gap frame.
  const lastGoodRef = useRef(new Map<string, WatchExperience>())
  if (resolved != null) lastGoodRef.current.set(slug, resolved)
  const experience =
    resolved !== undefined ? resolved : (lastGoodRef.current.get(slug) ?? null)

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
