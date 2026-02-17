import { readFileSync, realpathSync } from "node:fs"
import { resolve } from "node:path"

const PROMPTS_ROOT = resolve(process.cwd(), "../../packages/ai-config/prompts")

const SAFE_ID = /^[a-zA-Z0-9._-]+$/

export function loadPromptTemplate(id, version) {
  if (!SAFE_ID.test(id) || !SAFE_ID.test(version)) {
    throw new Error("Invalid prompt id or version")
  }
  const filePath = resolve(PROMPTS_ROOT, `${id}.${version}.md`)
  const resolvedFilePath = realpathSync(filePath)
  if (!resolvedFilePath.startsWith(PROMPTS_ROOT)) {
    throw new Error("Prompt path is outside of allowed directory")
  }
  return readFileSync(resolvedFilePath, "utf8")
}
