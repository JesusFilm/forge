import { gql } from "@apollo/client/core"
import { getGatewayClient } from "./gateway-client"

export type ResolveCollectionVideoIdsInput = {
  collectionIds: string[]
}

export type ResolveCollectionVideoIdsResult = {
  collectionVideoIds: Record<string, string[]>
  resolvedVideoIds: string[]
  missingCollectionIds: string[]
}

/**
 * Query gateway for top-level videos by ID, returning children for expansion.
 *
 * Collection IDs are coverage-style top-level video IDs (not JourneyCollection IDs).
 * Each collection expands to its children's IDs, or to its own ID if it has no children.
 */
const RESOLVE_COLLECTION_VIDEOS_QUERY = gql`
  query ResolveCollectionVideoIds($ids: [ID!]!) {
    videos(where: { ids: $ids, published: true }, limit: 2000) {
      id
      label
      children {
        id
      }
    }
  }
`

type CollectionVideo = {
  id: string
  label: string
  children: Array<{ id: string }>
}

export async function resolveCollectionVideoIds(
  input: ResolveCollectionVideoIdsInput,
): Promise<ResolveCollectionVideoIdsResult> {
  if (input.collectionIds.length === 0) {
    return {
      collectionVideoIds: {},
      resolvedVideoIds: [],
      missingCollectionIds: [],
    }
  }

  const { data } = await getGatewayClient().query<{
    videos: CollectionVideo[]
  }>({
    query: RESOLVE_COLLECTION_VIDEOS_QUERY,
    variables: { ids: input.collectionIds },
  })

  const returnedIds = new Set(data.videos.map((v) => v.id))
  const missingCollectionIds = input.collectionIds.filter(
    (id) => !returnedIds.has(id),
  )

  const collectionVideoIds: Record<string, string[]> = {}
  const allVideoIds = new Set<string>()

  for (const video of data.videos) {
    if (video.children.length > 0) {
      // Collection with children — include parent + all child IDs
      const childIds = video.children.map((c) => c.id)
      collectionVideoIds[video.id] = [video.id, ...childIds]
      allVideoIds.add(video.id)
      for (const id of childIds) allVideoIds.add(id)
    } else {
      // Leaf video — collection is the video itself
      collectionVideoIds[video.id] = [video.id]
      allVideoIds.add(video.id)
    }
  }

  return {
    collectionVideoIds,
    resolvedVideoIds: [...allVideoIds],
    missingCollectionIds,
  }
}
