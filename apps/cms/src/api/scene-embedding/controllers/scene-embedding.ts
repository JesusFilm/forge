import type { Core } from "@strapi/strapi"
import type { SceneEmbeddingInput } from "../services/indexer"
import {
  indexSceneEmbeddings,
  getSceneEmbeddingStats,
  getProcessedVideoLanguages,
} from "../services/indexer"

const EXPECTED_DIMS = 1536
const MAX_SCENES = 500

type StrapiContext = {
  status: number
  body: unknown
  request: {
    body?: {
      scenes?: SceneEmbeddingInput[]
    }
  }
}

function validateScene(
  scene: SceneEmbeddingInput,
  index: number,
): string | null {
  if (typeof scene.videoId !== "number") {
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
  if (
    !Array.isArray(scene.embedding) ||
    scene.embedding.length !== EXPECTED_DIMS ||
    !scene.embedding.every((v) => Number.isFinite(v))
  ) {
    return `scenes[${index}]: embedding must be ${EXPECTED_DIMS} finite numbers`
  }
  return null
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async index(ctx: StrapiContext) {
    const { scenes } = ctx.request.body ?? {}

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

    const seen = new Set<string>()
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i]
      if (!scene) {
        ctx.status = 400
        ctx.body = { error: `scenes[${i}] is null or undefined` }
        return
      }
      const err = validateScene(scene, i)
      if (err) {
        ctx.status = 400
        ctx.body = { error: err }
        return
      }
      const key = `${scene.videoId}:${scene.sceneIndex}`
      if (seen.has(key)) {
        ctx.status = 400
        ctx.body = {
          error: `Duplicate (videoId, sceneIndex) at scenes[${i}]: ${key}`,
        }
        return
      }
      seen.add(key)
    }

    try {
      const result = await indexSceneEmbeddings(strapi, scenes)
      ctx.status = 200
      ctx.body = result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes("violates foreign key")) {
        ctx.status = 404
        ctx.body = { error: "One or more video IDs not found" }
      } else {
        strapi.log.error(`[scene-embedding] Index failed: ${message}`)
        ctx.status = 500
        ctx.body = { error: "Failed to index scene embeddings" }
      }
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
      const entries = await getProcessedVideoLanguages(strapi)
      ctx.status = 200
      ctx.body = { entries }
    } catch {
      ctx.status = 503
      ctx.body = { error: "Scene embedding features not available" }
    }
  },
})
