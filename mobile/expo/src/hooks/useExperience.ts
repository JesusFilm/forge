import { useEffect, useState } from "react"

import { apolloClient } from "../lib/apolloClient"
import {
  getExperienceBySlug,
  getWatchHome,
  type MappedExperience,
} from "../lib/experienceService"

type ExperienceStatus =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: MappedExperience }

interface UseExperienceOptions {
  slug?: string
  fallbackSlug?: string
  locale: string
}

export function useExperience({
  slug,
  fallbackSlug,
  locale,
}: UseExperienceOptions) {
  const [state, setState] = useState<ExperienceStatus>({ status: "loading" })

  useEffect(() => {
    let cancelled = false
    setState({ status: "loading" })

    async function load() {
      const primary = slug
        ? getExperienceBySlug(apolloClient, slug, locale)
        : getWatchHome(apolloClient, locale)

      const result = await primary
      if (result.data) return result

      // Try fallback slug if primary failed
      if (fallbackSlug) {
        const fallback = await getExperienceBySlug(
          apolloClient,
          fallbackSlug,
          locale,
        )
        if (fallback.data) return fallback
      }

      return result
    }

    load()
      .then((result) => {
        if (cancelled) return
        if (result.error) {
          setState({ status: "error", message: result.error.message })
        } else if (!result.data) {
          setState({ status: "error", message: "No data returned" })
        } else {
          setState({ status: "success", data: result.data })
        }
      })
      .catch((err: Error) => {
        if (cancelled) return
        setState({ status: "error", message: err.message })
      })

    return () => {
      cancelled = true
    }
  }, [slug, fallbackSlug, locale])

  return state
}
