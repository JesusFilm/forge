"use server"

import "server-only"

import { adminGraphql } from "@forge/admin-graphql"

import type { CollectionDownloadEpisode } from "@/components/watch/collection-download-options"
import client from "@/lib/admin-client"
import { isWatchAudienceEnabled } from "@/lib/feature-flags"
import { tryAsContentSlug, tryAsLocaleSlug } from "@/lib/routes"

const COLLECTION = adminGraphql(`
  query WatchPartnerDownloadCollection($slug: String!, $locale: String!, $languageSlug: String!) {
    videoBySlug(slug: $slug) {
      slug
      locales(locale: $locale, languageSlug: $languageSlug) { title }
      children {
        order
        child {
          documentId: id
          slug
          locales(locale: $locale, languageSlug: $languageSlug) { title }
        }
      }
    }
  }
`)

export type WatchPartnerDownloadCollection = {
  slug: string
  title: string
  episodes: CollectionDownloadEpisode[]
}

/** Default-off: an unreadable flag is off, so the action stays dark. */
async function isPartnerDownloadsEnabled(): Promise<boolean> {
  try {
    return await isWatchAudienceEnabled()
  } catch {
    return false
  }
}

/**
 * Lazy metadata only. Download availability and capabilities keep their existing resolver.
 * A Server Action is a public POST endpoint whether or not any UI mounts it, so
 * the audience release gate is checked before any input or Admin work.
 */
export async function loadWatchPartnerDownloadCollection(input: {
  collectionSlug: string
  languageSlug: string
  locale: string
}): Promise<
  | { ok: true; collection: WatchPartnerDownloadCollection }
  | { ok: false; reason: "invalid-input" | "unavailable" | "failed" }
> {
  if (!(await isPartnerDownloadsEnabled())) {
    return { ok: false, reason: "unavailable" }
  }
  const slug = tryAsContentSlug(input.collectionSlug)
  const languageSlug = tryAsLocaleSlug(input.languageSlug)
  if (
    !slug ||
    !languageSlug ||
    !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(input.locale)
  ) {
    return { ok: false, reason: "invalid-input" }
  }
  try {
    const result = await client.query({
      query: COLLECTION,
      variables: { slug, locale: input.locale, languageSlug },
      fetchPolicy: "no-cache",
    })
    if (result.error) return { ok: false, reason: "failed" }
    if (!result.data?.videoBySlug) return { ok: false, reason: "unavailable" }
    const video = result.data.videoBySlug
    const episodes = (video.children ?? []).flatMap((relation) => {
      const child = relation.child
      const childSlug = child?.slug && tryAsContentSlug(child.slug)
      if (!child?.documentId || !childSlug) return []
      return [
        {
          documentId: child.documentId,
          slug: childSlug,
          title:
            child.locales?.find((entry) => entry.title?.trim())?.title ??
            childSlug,
          order: relation.order ?? null,
        },
      ]
    })
    if (!episodes.length) return { ok: false, reason: "unavailable" }
    return {
      ok: true,
      collection: {
        slug,
        title:
          video.locales?.find((entry) => entry.title?.trim())?.title ?? slug,
        episodes,
      },
    }
  } catch {
    return { ok: false, reason: "failed" }
  }
}
