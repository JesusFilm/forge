import { createRequire } from "node:module"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, "../../..")
const source = resolve(process.env.STUDIO_QA_SOURCE_ROOT ?? repo)
const managerRequire = createRequire(resolve(repo, "apps/manager/package.json"))
// Vite is the workspace's pinned Vitest runtime; no global tooling is needed.
const testRequire = createRequire(managerRequire.resolve("vitest/package.json"))
const { createServer } = await import(testRequire.resolve("vite"))
const theme =
  (
    await readFile(resolve(repo, "apps/manager/src/app/globals.css"), "utf8")
  ).match(/:root \{[\s\S]*?\n\}/)?.[0] ?? ""
const server = await createServer({
  configFile: false,
  root: here,
  publicDir: resolve(repo, ".tmp/studio-feedback"),
  esbuild: { jsx: "automatic" },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      {
        find: "@qa",
        replacement: resolve(source, "apps/manager/src/features/video-studio"),
      },
      { find: "@", replacement: resolve(source, "apps/manager/src") },
      {
        find: /^@forge\/studio-contracts$/,
        replacement: resolve(source, "packages/studio-contracts/src/index.ts"),
      },
      {
        find: "react",
        replacement: resolve(repo, "apps/manager/node_modules/react"),
      },
      {
        find: "react-dom",
        replacement: resolve(repo, "apps/manager/node_modules/react-dom"),
      },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 4179,
    strictPort: true,
    fs: { allow: [repo, source] },
  },
  plugins: [
    {
      name: "studio-qa",
      configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          if (request.url === "/theme.css") {
            response.setHeader("Content-Type", "text/css")
            response.end(
              `${theme}\nbody{font-family:Arial,sans-serif;margin:24px}.nle-inspector{max-width:320px}`,
            )
            return
          }
          if (request.url?.startsWith("/media/")) {
            setTimeout(next, 180)
            return
          }
          if (request.url !== "/api/shorts/preview") {
            next()
            return
          }
          let body = ""
          request.on("data", (part) => {
            body += part
          })
          request.on("end", () => {
            const { document } = JSON.parse(body)
            const videos = document.items.filter(
              (item) => item.kind === "video",
            )
            response.setHeader("Content-Type", "application/json")
            response.end(
              JSON.stringify({
                input: {
                  document,
                  code: {},
                  media: Object.fromEntries(
                    videos.map((item) => [
                      item.id,
                      {
                        file: `${item.id}.m3u8`,
                        sourceStartMs: 0,
                        kind: "hls",
                      },
                    ]),
                  ),
                },
                urls: Object.fromEntries(
                  videos.map((item) => [
                    `${item.id}.m3u8`,
                    `http://127.0.0.1:4179/media/source.m3u8?clip=${item.id}`,
                  ]),
                ),
                files: [],
              }),
            )
          })
        })
      },
    },
  ],
})
await server.listen()
console.log("Studio QA: http://127.0.0.1:4179 — local synthetic media only")
