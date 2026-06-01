import { rmSync } from "node:fs"
import { fileURLToPath } from "node:url"

const nextOutputDir = fileURLToPath(new URL("../.next", import.meta.url))

rmSync(nextOutputDir, { recursive: true, force: true })
