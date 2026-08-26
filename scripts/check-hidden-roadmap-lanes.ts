import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"

const repoRoot = process.cwd()
const roadmapRoot = path.join(repoRoot, "docs/roadmap")

async function main(): Promise<void> {
  process.env.ROADMAP_DIR = roadmapRoot
  const [{ getAllFeatures }, { renderRoadmapReadme }] = await Promise.all([
    import("../apps/roadmap/lib/features"),
    import("../apps/roadmap/lib/markdown"),
  ])

  const hiddenLanes = ["ai-chat", "rag"]
  const features = getAllFeatures()
  const rendered = renderRoadmapReadme(features)
  const committed = await readFile(path.join(roadmapRoot, "README.md"), "utf8")

  for (const lane of hiddenLanes) {
    assert.equal(
      features.some((feature) => feature.filePath.includes(`/${lane}/`)),
      false,
      `${lane} must not be loaded by the public roadmap`,
    )
    assert.doesNotMatch(rendered, new RegExp(`docs/roadmap/${lane}/|/${lane}/`))
    assert.doesNotMatch(
      committed,
      new RegExp(`docs/roadmap/${lane}/|/${lane}/`),
    )
  }

  console.log("Hidden roadmap lanes remain excluded from public outputs.")
}

void main()
