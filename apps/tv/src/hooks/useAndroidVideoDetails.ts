import { useCallback, useEffect, useRef, useState } from "react"

import { getApolloClient } from "../lib/apolloClient"
import { createAndroidVideoDetailsCache } from "../lib/androidVideoDetailsCache"
import { GET_VIDEO_BY_SLUG, type WatchVideoData } from "../lib/videoQueries"

const cache = createAndroidVideoDetailsCache(async (slug) => {
  const result = await getApolloClient().query({
    query: GET_VIDEO_BY_SLUG,
    variables: { locale: "en", slug },
    fetchPolicy: "no-cache",
  })
  if (!result.data) throw new Error("Video details unavailable")
  return result.data
})

export function useAndroidVideoDetails(slug: string, enabled: boolean) {
  const [state, setState] = useState<{
    slug: string
    data?: WatchVideoData
    loading: boolean
    error: Error | null
  }>(() => {
    const data = cache.read(slug)
    return {
      slug,
      data,
      loading: enabled && !!slug && data == null,
      error: null,
    }
  })
  const generation = useRef(0)
  const load = useCallback(
    async (refresh = false) => {
      if (!enabled || !slug) return
      const id = ++generation.current
      const cached = refresh ? undefined : cache.read(slug)
      setState({ slug, data: cached, loading: cached == null, error: null })
      try {
        const data = await cache.load(slug, refresh)
        if (generation.current === id)
          setState({ slug, data, loading: false, error: null })
      } catch (error) {
        if (generation.current === id)
          setState({
            slug,
            loading: false,
            error:
              error instanceof Error
                ? error
                : new Error("Video details unavailable"),
          })
      }
    },
    [slug, enabled],
  )
  useEffect(() => {
    void load()
    return () => {
      generation.current++
    }
  }, [load])
  const refetch = useCallback(() => load(true), [load])
  const current =
    state.slug === slug
      ? state
      : { data: cache.read(slug), loading: enabled && !!slug, error: null }
  return { ...current, refetch }
}
