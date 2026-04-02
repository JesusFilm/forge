import test from "node:test"
import assert from "node:assert/strict"
import {
  buildVideoCollections,
  determineCoverageForItems,
  type RawVideoNode,
} from "./video-collections"

function buildVideoNode(
  overrides: Partial<RawVideoNode> & Pick<RawVideoNode, "documentId">,
): RawVideoNode {
  return {
    documentId: overrides.documentId,
    coreId: overrides.coreId ?? overrides.documentId,
    title: overrides.title ?? overrides.documentId,
    label: overrides.label ?? "episode",
    slug: overrides.slug ?? overrides.documentId,
    aiMetadata: overrides.aiMetadata ?? null,
    images: overrides.images ?? [],
    parents: overrides.parents ?? [],
    variants: overrides.variants ?? [],
    subtitles: overrides.subtitles ?? [],
  }
}

test("buildVideoCollections groups children under present parents", () => {
  const parent = buildVideoNode({
    documentId: "parent-1",
    label: "collection",
    title: "Collection One",
  })
  const child = buildVideoNode({
    documentId: "child-1",
    title: "Episode One",
    parents: [{ documentId: "parent-1" }],
  })

  const collections = buildVideoCollections([parent, child], new Set(["en"]))

  assert.equal(collections.length, 1)
  assert.equal(collections[0]?.title, "Collection One")
  assert.deepEqual(
    collections[0]?.videos.map((video) => video.title),
    ["Episode One"],
  )
})

test("buildVideoCollections falls back to standalone when a parent is missing", () => {
  const orphanedChild = buildVideoNode({
    documentId: "child-1",
    title: "Lost Episode",
    parents: [{ documentId: "missing-parent" }],
  })

  const collections = buildVideoCollections([orphanedChild], new Set(["en"]))

  assert.equal(collections.length, 1)
  assert.equal(collections[0]?.id, "standalone")
  assert.deepEqual(
    collections[0]?.videos.map((video) => video.title),
    ["Lost Episode"],
  )
})

test("determineCoverageForItems evaluates all available languages when none are selected", () => {
  const coverage = determineCoverageForItems(
    [
      {
        aiGenerated: true,
        language: { coreId: "en" },
      },
      {
        aiGenerated: false,
        language: { coreId: "es" },
      },
    ],
    new Set(),
  )

  assert.equal(coverage, "human")
})
