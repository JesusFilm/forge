import { readFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const config = JSON.parse(
  await readFile(resolve(process.argv[2], "environment.json"), "utf8"),
)
if (
  config.DATABASE_URL !==
    "postgresql://tataihono@127.0.0.1:55460/forge_studio_460_fresh" ||
  config.ADMIN_GRAPHQL_URL !== "http://127.0.0.1:55472/api/graphql"
)
  throw new Error("Only the guarded local harness environment is supported")
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const child = spawn(
  "pnpm",
  ["exec", "next", "dev", "--hostname", "127.0.0.1", "--port", "55473"],
  {
    cwd: resolve(root, "apps/manager"),
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ...config,
      NODE_ENV: "development",
      MANAGER_DATA_MODE: "admin",
      MANAGER_BACKEND_MODE: "admin",
    },
    stdio: "inherit",
    detached: true,
  },
)
function stop() {
  process.kill(-child.pid, "SIGTERM")
  process.exit(0)
}
process.on("SIGINT", stop)
process.on("SIGTERM", stop)
child.on("exit", (code) => {
  process.exitCode = code ?? 1
})
