import type { ApolloClient } from "@apollo/client"
import { useEffect, useState } from "react"

import { getApolloClient } from "../lib/apolloClient"
import {
  getExperienceBySlug,
  getWatchHome,
  type ExperienceResult,
  type MappedExperience,
} from "../lib/experienceService"

type ExperienceStatus =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: MappedExperience }

export interface UseExperienceOptions {
  slug?: string
  fallbackSlug?: string
  locale: string
}

/**
 * Loads an experience with optional fallback.
 * Extracted for testability — the hook wraps this in useState/useEffect.
 */
export async function loadExperience(
  client: ApolloClient,
  { slug, fallbackSlug, locale }: UseExperienceOptions,
): Promise<ExperienceResult> {
  const primary = slug
    ? getExperienceBySlug(client, slug, locale)
    : getWatchHome(client, locale)

  const result = await primary
  if (result.data) return result

  // Try fallback slug if primary failed
  if (fallbackSlug) {
    const fallback = await getExperienceBySlug(client, fallbackSlug, locale)
    if (fallback.data) return fallback
  }

  return result
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

    loadExperience(getApolloClient(), { slug, fallbackSlug, locale })
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
