import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const PROMPTS_ROOT = resolve(process.cwd(), "../../packages/ai-config/prompts")

export function loadPromptTemplate(id, version) {
  const file = resolve(PROMPTS_ROOT, `${id}.${version}.md`)
  return readFileSync(file, "utf8")
}
