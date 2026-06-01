import { readdirSync, rmSync } from "node:fs"
import { fileURLToPath } from "node:url"

const messagesDir = fileURLToPath(new URL("../messages", import.meta.url))
const serverAppDir = fileURLToPath(
  new URL("../.next/server/app", import.meta.url),
)

const uiLocales = readdirSync(messagesDir)
  .filter((fileName) => fileName.endsWith(".json"))
  .map((fileName) => fileName.replace(/\.json$/, ""))

for (const locale of uiLocales) {
  rmSync(new URL(`../.next/server/app/${locale}`, import.meta.url), {
    recursive: true,
    force: true,
  })
}

console.log(
  `Pruned concrete ISR output for ${uiLocales.length} UI locale(s) from ${serverAppDir}`,
)
