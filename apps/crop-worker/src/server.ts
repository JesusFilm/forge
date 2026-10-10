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
  nodeEnv?: JobsRouteOptions["nodeEnv"]
  runFingerprintImpl?: JobsRouteOptions["runFingerprintImpl"]
  runRenderImpl?: JobsRouteOptions["runRenderImpl"]
}

export function createHandleRequest({
  queue = createJobQueue(),
  auth,
  nodeEnv,
  runFingerprintImpl,
  runRenderImpl,
}: ServerDependencies = {}) {
  const handleJobsRoute = createJobsRoute({
    queue,
    auth,
    nodeEnv,
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

// Top-level error boundary. Must never itself throw/reject: if a route
// failed AFTER writing headers, a second writeHead would raise
// ERR_HTTP_HEADERS_SENT inside the handler — so check headersSent and fall
// back to destroying the socket, with a belt-and-braces try/catch.
export function createRequestListener(handler = handleRequest) {
  return async function listen(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      await handler(request, response)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(
        `[crop-worker] event=request_failed message=${JSON.stringify(message)}`,
      )
      try {
        if (response.headersSent) {
          response.destroy()
        } else {
          sendJson(response, 500, { error: "internal_error" })
        }
      } catch {
        response.destroy()
      }
    }
  }
}

export function startServer(port = env.PORT): void {
  assertRuntimeEnv()

  const listener = createRequestListener()
  createServer((request, response) => {
    void listener(request, response)
  }).listen(port, () => {
    console.log(`crop-worker listening on :${port}`)
  })
}

if (env.NODE_ENV !== "test") {
  startServer()
}
