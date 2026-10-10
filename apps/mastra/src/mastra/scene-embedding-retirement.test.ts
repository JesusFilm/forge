import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8")

function extractRegisterApiRouteCall(source: string, path: string): string {
  const start = source.indexOf(`registerApiRoute("${path}"`)
  expect(start).toBeGreaterThanOrEqual(0)

  let depth = 0
  for (let i = start; i < source.length; i++) {
    const char = source[i]
    if (char === "(") depth++
    if (char === ")") {
      depth--
      if (depth === 0) {
        return source.slice(start, i + 1)
      }
    }
  }

  throw new Error(`registerApiRoute(${path}) had no matching close paren`)
}

describe("retired scene embedding route", () => {
  it("keeps only a 410 tombstone for the legacy scene endpoint", () => {
    const occurrences =
      indexSource.match(/registerApiRoute\("\/forge-scene-embeddings"/g) ?? []
    expect(occurrences).toHaveLength(1)

    const route = extractRegisterApiRouteCall(
      indexSource,
      "/forge-scene-embeddings",
    )
    expect(route).toContain("legacy_scene_embedding_pipeline_removed")
    expect(route).toContain("retryable: false")
    expect(route).toContain("410")
    expect(route).not.toContain("getWorkflow")
    expect(route).not.toContain("handleSceneEmbedding")
  })

  it("does not register the deleted scene embedding workflow", () => {
    expect(indexSource).not.toContain("sceneEmbeddingWorkflow")
  })
})
