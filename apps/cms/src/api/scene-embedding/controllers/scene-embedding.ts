import type { Core } from "@strapi/strapi"
import type { SceneEmbeddingInput } from "../services/indexer"
import {
  SceneEmbeddingIndexError,
  indexSceneEmbeddings,
  getSceneEmbeddingStats,
  getProcessedVideoIds,
} from "../services/indexer"
import { getRecommendations, VideoNotFoundError } from "../services/recommender"

export const EXPECTED_DIMS = 1536
export const MAX_SCENES = 500

type StrapiContext = {
  status: number
  body: unknown
  request: {
    body?: {
      videoId?: number
      videoDocumentId?: string
      scenes?: SceneEmbeddingInput[]
      skipDelete?: boolean
    }
    query?: Record<string, string | undefined>
  }
}

function isFiniteSceneVector(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === EXPECTED_DIMS &&
    value.every((entry) => Number.isFinite(entry))
  )
}

function validateScene(
  scene: SceneEmbeddingInput,
  index: number,
  options: { requestTargetProvided: boolean },
): string | null {
  if (!options.requestTargetProvided && typeof scene.videoId !== "number") {
    return `scenes[${index}]: videoId must be a number`
  }
  if (typeof scene.muxAssetId !== "string" || !scene.muxAssetId) {
    return `scenes[${index}]: muxAssetId is required`
  }
  if (typeof scene.playbackId !== "string" || !scene.playbackId) {
    return `scenes[${index}]: playbackId is required`
  }
  if (typeof scene.sceneIndex !== "number") {
    return `scenes[${index}]: sceneIndex must be a number`
  }
  if (typeof scene.startSeconds !== "number") {
    return `scenes[${index}]: startSeconds must be a number`
  }
  if (typeof scene.description !== "string" || !scene.description) {
    return `scenes[${index}]: description is required`
  }
  if (!isFiniteSceneVector(scene.embedding)) {
    return `scenes[${index}]: embedding must be ${EXPECTED_DIMS} finite numbers`
  }
  return null
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async index(ctx: StrapiContext) {
    const { videoId, videoDocumentId, scenes, skipDelete } =
      ctx.request.body ?? {}
    const requestTargetProvided =
      typeof videoId === "number" ||
      (typeof videoDocumentId === "string" && videoDocumentId.trim().length > 0)

    if (!Array.isArray(scenes) || scenes.length === 0) {
      ctx.status = 400
      ctx.body = { error: "scenes (non-empty array) is required" }
      return
    }

    if (scenes.length > MAX_SCENES) {
      ctx.status = 400
      ctx.body = { error: `Maximum ${MAX_SCENES} scenes per request` }
      return
    }

    for (let index = 0; index < scenes.length; index += 1) {
      const scene = scenes[index]
      if (!scene) {
        ctx.status = 400
        ctx.body = { error: `scenes[${index}] is null or undefined` }
        return
      }

      const error = validateScene(scene, index, { requestTargetProvided })
      if (error) {
        ctx.status = 400
        ctx.body = { error }
        return
      }
    }

    try {
      const result = await indexSceneEmbeddings(
        strapi,
        {
          videoId,
          videoDocumentId,
          scenes,
        },
        {
          skipDelete: skipDelete === true,
        },
      )
      ctx.status = 200
      ctx.body = result
    } catch (error) {
      if (error instanceof SceneEmbeddingIndexError) {
        ctx.status = error.status
        ctx.body = { error: error.code }
        return
      }

      const message = error instanceof Error ? error.message : String(error)
      if (message.includes("violates foreign key")) {
        ctx.status = 404
        ctx.body = { error: "video_not_found" }
        return
      }

      strapi.log.error(`[scene-embedding] Index failed: ${message}`)
      ctx.status = 500
      ctx.body = { error: "Failed to index scene embeddings" }
    }
  },

  async stats(ctx: StrapiContext) {
    try {
      const result = await getSceneEmbeddingStats(strapi)
      ctx.status = 200
      ctx.body = result
    } catch {
      ctx.status = 503
      ctx.body = { error: "Scene embedding features not available" }
    }
  },

  async processedVideoIds(ctx: StrapiContext) {
    try {
      const videoIds = await getProcessedVideoIds(strapi)
      ctx.status = 200
      ctx.body = { videoIds }
    } catch {
      ctx.status = 503
      ctx.body = { error: "Scene embedding features not available" }
    }
  },

  async recommendations(ctx: StrapiContext) {
    const query = ctx.request.query ?? {}

    const videoIdRaw = query.videoId
    if (!videoIdRaw || isNaN(Number(videoIdRaw))) {
      ctx.status = 400
      ctx.body = { error: "videoId (numeric) is required" }
      return
    }

    const locale = query.locale
    if (!locale) {
      ctx.status = 400
      ctx.body = { error: "locale is required" }
      return
    }

    const videoId = Number(videoIdRaw)

    let sceneIndex: number | undefined
    if (query.sceneIndex !== undefined) {
      sceneIndex = Number(query.sceneIndex)
      if (isNaN(sceneIndex)) {
        ctx.status = 400
        ctx.body = { error: "sceneIndex must be a number" }
        return
      }
    }

    const limit = query.limit ? Number(query.limit) || undefined : undefined

    try {
      const results = await getRecommendations(strapi, {
        videoId,
        locale,
        sceneIndex,
        limit,
      })
      ctx.status = 200
      ctx.body = { recommendations: results }
    } catch (error) {
      if (error instanceof VideoNotFoundError) {
        ctx.status = 404
        ctx.body = { error: error.message }
      } else {
        strapi.log.error(
          `[scene-embedding] Recommendations failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
        ctx.status = 503
        ctx.body = { error: "Scene embedding features not available" }
      }
    }
  },
})
