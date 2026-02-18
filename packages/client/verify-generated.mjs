import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const stamp = "// AUTO-GENERATED FILE. DO NOT EDIT."
const file = resolve("src/generated/graphql.ts")

if (!existsSync(file)) {
  throw new Error(`Generated file missing: ${file}. Run pnpm run generate.`)
}
const content = readFileSync(file, "utf8")
if (!content.includes(stamp)) {
  throw new Error(
    `Generated file stamp missing: ${file}. Manual edits are not allowed.`,
  )
}

console.log("Generated code verification passed.")
