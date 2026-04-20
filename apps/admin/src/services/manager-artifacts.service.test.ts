import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  ManagerArtifactError,
  readSceneAnalysisArtifact,
  type SceneAnalysisResult,
} from "./manager-artifacts.service"

// The storage module picks its backend at import time based on
// env.RAILWAY_S3_BUCKET. These tests rely on the local fallback, which
// activates when that env var is unset. `pnpm --filter @forge/admin
// test` runs without Doppler, so the fallback is the default.
const LOCAL_DIR = join(process.cwd(), ".tmp", "artifacts")

async function seedArtifact(assetId: string, body: unknown) {
  const dir = join(LOCAL_DIR, assetId)
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, "scene-analysis.json"),
    typeof body === "string" ? body : JSON.stringify(body),
  )
}

async function removeArtifact(assetId: string) {
  await rm(join(LOCAL_DIR, assetId), { recursive: true, force: true })
}

const SEEDED_IDS = [
  "test-asset-valid",
  "test-asset-empty",
  "test-asset-bad-json",
]

const validArtifact: SceneAnalysisResult = {
  scenes: [
    {
      sceneIndex: 0,
      startSeconds: 0,
      endSeconds: 12.5,
      chapterTitle: "Opening",
      description: "A wide shot of a dusty road.",
      themes: ["journey"],
      bibleVerses: [],
      demographics: ["adult"],
      spiritualContext: ["beginnings"],
    },
    {
      sceneIndex: 1,
      startSeconds: 12.5,
      endSeconds: null,
      chapterTitle: null,
      description: "Two figures meet at the crossroads.",
      themes: ["encounter", "providence"],
      bibleVerses: ["Genesis 24:17"],
      demographics: [],
      spiritualContext: [],
    },
  ],
  totalInputTokens: 1234,
  totalOutputTokens: 567,
}

describe("readSceneAnalysisArtifact", () => {
  beforeAll(async () => {
    await seedArtifact("test-asset-valid", validArtifact)
    await seedArtifact("test-asset-empty", { scenes: [] })
    await seedArtifact("test-asset-bad-json", "not-json-at-all")
  })

  afterAll(async () => {
    await Promise.all(SEEDED_IDS.map(removeArtifact))
  })

  it("returns the parsed result for a well-formed artifact", async () => {
    const result = await readSceneAnalysisArtifact("test-asset-valid")
    expect(result.scenes).toHaveLength(2)
    expect(result.scenes[0]?.description).toBe("A wide shot of a dusty road.")
    expect(result.scenes[1]?.endSeconds).toBeNull()
  })

  it("returns an empty scenes array without error when scenes is empty", async () => {
    const result = await readSceneAnalysisArtifact("test-asset-empty")
    expect(result.scenes).toEqual([])
  })

  it("throws artifact_missing when the artifact does not exist", async () => {
    await expect(
      readSceneAnalysisArtifact("never-written-id"),
    ).rejects.toMatchObject({
      name: "ManagerArtifactError",
      code: "artifact_missing",
    })
  })

  it("throws artifact_invalid when the file is not valid JSON", async () => {
    await expect(
      readSceneAnalysisArtifact("test-asset-bad-json"),
    ).rejects.toMatchObject({
      name: "ManagerArtifactError",
      code: "artifact_invalid",
    })
  })

  it("throws artifact_invalid when the payload fails the schema", async () => {
    const assetId = "test-asset-wrong-shape"
    await seedArtifact(assetId, { scenes: [{ sceneIndex: "nope" }] })
    try {
      await expect(readSceneAnalysisArtifact(assetId)).rejects.toBeInstanceOf(
        ManagerArtifactError,
      )
      await expect(readSceneAnalysisArtifact(assetId)).rejects.toMatchObject({
        code: "artifact_invalid",
      })
    } finally {
      await removeArtifact(assetId)
    }
  })
})
