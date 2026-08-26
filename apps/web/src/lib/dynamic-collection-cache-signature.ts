import "server-only"

import { createHmac, timingSafeEqual } from "node:crypto"

import { env } from "@/env"
import {
  WATCH_COLLECTION_FEED_CACHE_SIGNATURE_PATTERN,
  WATCH_COLLECTION_FEED_PROFILES,
  normalizeDynamicCollectionFeedInput,
  type DynamicCollectionFeedCacheSignatures,
  type NormalizedDynamicCollectionFeedInput,
} from "@/lib/dynamic-collection-contract"

const SIGNATURE_DOMAIN = "watch-dynamic-collection-feed-cache-v1"

type CacheSignatureInput = Omit<
  NormalizedDynamicCollectionFeedInput,
  "cacheSignature"
>

function signaturePayload(input: CacheSignatureInput): string {
  return JSON.stringify([
    SIGNATURE_DOMAIN,
    input.locale,
    input.languageSlug,
    input.cacheScope,
    input.after,
    input.excludedIds,
    input.excludedSlugs,
    input.first,
    input.cardsPerParent,
  ])
}

export function createDynamicCollectionFeedCacheSignature(
  input: CacheSignatureInput,
): string {
  return createHmac("sha256", env.REVALIDATION_SECRET)
    .update(signaturePayload(input))
    .digest("base64url")
}

export function isDynamicCollectionFeedCacheSignatureValid(
  input: CacheSignatureInput,
  signature: string | null,
): boolean {
  if (
    signature === null ||
    !WATCH_COLLECTION_FEED_CACHE_SIGNATURE_PATTERN.test(signature)
  ) {
    return false
  }

  const expected = createDynamicCollectionFeedCacheSignature(input)
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}

export function createInitialDynamicCollectionFeedCacheSignatures(input: {
  locale: string
  languageSlug: string
  cacheScope: "live" | "preview"
  excludedIds: readonly string[]
  excludedSlugs: readonly string[]
}): DynamicCollectionFeedCacheSignatures {
  return {
    mobile: createDynamicCollectionFeedCacheSignature(
      normalizeDynamicCollectionFeedInput({
        ...input,
        ...WATCH_COLLECTION_FEED_PROFILES.mobile,
      }),
    ),
    desktop: createDynamicCollectionFeedCacheSignature(
      normalizeDynamicCollectionFeedInput({
        ...input,
        ...WATCH_COLLECTION_FEED_PROFILES.desktop,
      }),
    ),
  }
}
