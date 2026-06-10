import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"
import { assertRuntimeEnv, env } from "./config/env.js"
import { sendJson } from "./http.js"
import { createJobQueue, type JobQueue } from "./jobs.js"
import { createJobsRoute, type JobsRouteOptions } from "./routes/jobs.js"

export type ServerDependencies = {
  queue?: JobQueue
  auth?: JobsRouteOptions["auth"]
  runFingerprintImpl?: JobsRouteOptions["runFingerprintImpl"]
  runRenderImpl?: JobsRouteOptions["runRenderImpl"]
}

export function createHandleRequest({
  queue = createJobQueue(),
  auth,
  runFingerprintImpl,
  runRenderImpl,
}: ServerDependencies = {}) {
  const handleJobsRoute = createJobsRoute({
    queue,
    auth,
    runFingerprintImpl,
    runRenderImpl,
  })

  return async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const method = request.method ?? "GET"
    const url = new URL(request.url ?? "/", "http://localhost")

    if (method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true, service: "crop-worker" })
      return
    }

    if (await handleJobsRoute(request, response, url)) {
      return
    }

    sendJson(response, 404, { error: "not_found" })
  }
}

export const handleRequest = createHandleRequest()

export function startServer(port = env.PORT): void {
  assertRuntimeEnv()

  createServer((request, response) => {
    void handleRequest(request, response).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      console.error(
        `[crop-worker] event=request_failed message=${JSON.stringify(message)}`,
      )
      sendJson(response, 500, { error: "internal_error" })
    })
  }).listen(port, () => {
    console.log(`crop-worker listening on :${port}`)
  })
}

if (env.NODE_ENV !== "test") {
  startServer()
}
