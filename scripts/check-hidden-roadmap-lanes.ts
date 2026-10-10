import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import type { Feature } from "../apps/roadmap/lib/features"

const repoRoot = process.cwd()
const roadmapRoot = path.join(repoRoot, "docs/roadmap")
const hiddenLanes = ["ai-chat", "rag"]
const registrationSources = [
  "apps/roadmap/lib/features.ts",
  "apps/roadmap/lib/markdown.ts",
  "apps/roadmap/scripts/generate-roadmap-readme.js",
]

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function assertHiddenLanesStayHidden(
  features: Feature[],
  rendered: string,
  committed: string,
): void {
  assert.ok(
    features.length > 0,
    "public roadmap must load at least one feature",
  )

  for (const lane of hiddenLanes) {
    assert.equal(
      features.some((feature) => feature.filePath.includes(`/${lane}/`)),
      false,
      `${lane} must not be loaded by the public roadmap`,
    )
    const emittedLink = new RegExp(`\\]\\(${escapeRegex(lane)}/`)
    assert.doesNotMatch(rendered, emittedLink)
    assert.doesNotMatch(committed, emittedLink)
  }
}

async function main(): Promise<void> {
  process.env.ROADMAP_DIR = roadmapRoot
  const [{ getAllFeatures }, { renderRoadmapReadme }] = await Promise.all([
    import("../apps/roadmap/lib/features"),
    import("../apps/roadmap/lib/markdown"),
  ])

  const features = getAllFeatures()
  const rendered = renderRoadmapReadme(features)
  const committed = await readFile(path.join(roadmapRoot, "README.md"), "utf8")

  assertHiddenLanesStayHidden(features, rendered, committed)

  for (const sourcePath of registrationSources) {
    const source = await readFile(path.join(repoRoot, sourcePath), "utf8")
    for (const lane of hiddenLanes) {
      assert.doesNotMatch(source, new RegExp(`["']${escapeRegex(lane)}["']`))
    }
  }

  console.log("Hidden roadmap lanes remain excluded from public outputs.")
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  void main()
}
