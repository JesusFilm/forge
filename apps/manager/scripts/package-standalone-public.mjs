import { access, cp } from "node:fs/promises"

// Next's standalone output does not automatically include public assets.
const target = ".next/standalone/apps/manager"
await access(`${target}/server.js`)
await access("public/shorts-preview/runtime.js")
await cp("public", `${target}/public`, { recursive: true })
