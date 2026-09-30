import { createRequire } from "node:module"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
const here = dirname(fileURLToPath(import.meta.url)),
  repo = resolve(here, "../../..")
const source = resolve(process.env.STUDIO_QA_SOURCE_ROOT ?? repo)
const fixture = process.env.STUDIO_QA_MEDIA_ROOT
if (!fixture)
  throw new Error(
    "Set STUDIO_QA_MEDIA_ROOT to the local contained-render representative-30s fixture",
  )
const managerRequire = createRequire(resolve(repo, "apps/manager/package.json"))
const testRequire = createRequire(managerRequire.resolve("vitest/package.json"))
const { createServer } = await import(testRequire.resolve("vite"))
const theme =
  (
    await readFile(resolve(repo, "apps/manager/src/app/globals.css"), "utf8")
  ).match(/:root \{[\s\S]*?\n\}/)?.[0] ?? ""
const server = await createServer({
  configFile: false,
  root: here,
  esbuild: { jsx: "automatic" },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      {
        find: "@candidate-allowance",
        replacement: resolve(
          repo,
          "apps/manager/src/features/video-studio/narration-allowance.tsx",
        ),
      },
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
        find: /^@forge\/studio-contracts\/(.*)$/,
        replacement: resolve(source, "packages/studio-contracts/src/$1.ts"),
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
    port: Number(process.env.STUDIO_QA_PORT ?? 4186),
    strictPort: true,
    fs: { allow: [repo, source] },
  },
  plugins: [
    {
      name: "review-fixture",
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (request.url === "/theme.css") {
            response.setHeader("Content-Type", "text/css")
            response.end(
              `${theme}\nbody{font-family:Arial,sans-serif;margin:24px}`,
            )
            return
          }
          const name = request.url?.slice(1)
          if (
            ![
              "document.json",
              "context.json",
              "evidence.json",
              "render.mp4",
            ].includes(name)
          ) {
            next()
            return
          }
          try {
            const bytes =
              name === "context.json"
                ? Buffer.from(
                    JSON.stringify(
                      (({ inputHash, output, outputReadyAt }) => ({
                        inputHash,
                        output,
                        outputReadyAt,
                      }))(
                        JSON.parse(
                          await readFile(
                            resolve(fixture, "evidence.json"),
                            "utf8",
                          ),
                        ),
                      ),
                    ),
                  )
                : await readFile(resolve(fixture, name))
            setTimeout(() => {
              response.setHeader(
                "Content-Type",
                name.endsWith("json") ? "application/json" : "video/mp4",
              )
              response.end(bytes)
            }, 180)
          } catch {
            response.statusCode = 404
            response.end()
          }
        })
      },
    },
  ],
})
await server.listen()
console.log(
  `Unauthenticated synthetic review fixture: http://127.0.0.1:${process.env.STUDIO_QA_PORT ?? 4186}`,
)
