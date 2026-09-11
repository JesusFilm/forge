import { build } from "esbuild"
import { cp, mkdir } from "node:fs/promises"

// Invoked after mastra build (which owns/cleans .mastra). Relative URLs in
// migrator output resolve ../../chat-migrations, as in the source layout.
await mkdir(".mastra/operations/src/scripts", { recursive: true })
await build({
  entryPoints: [
    "src/scripts/migrate-ai-chat-database.ts",
    "src/scripts/restore-ai-chat-markers.ts",
    "src/scripts/check-ai-chat-database-readiness.ts",
  ],
  outdir: ".mastra/operations/src/scripts",
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node22",
  outExtension: { ".js": ".mjs" },
})
await cp("chat-migrations", ".mastra/operations/chat-migrations", {
  recursive: true,
})
