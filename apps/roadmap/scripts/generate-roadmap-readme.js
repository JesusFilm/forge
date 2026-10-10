const fs = require("fs")
const path = require("path")

const { getAllFeatures } = require("../lib/features.ts")
const { renderRoadmapReadme } = require("../lib/markdown.ts")

const readmePath = path.resolve(process.cwd(), "../../docs/roadmap/README.md")

const readme = renderRoadmapReadme(getAllFeatures(), new Date())

fs.writeFileSync(readmePath, `${readme}\n`)
console.log(`Updated ${readmePath}`)
