import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"
import { WORKER_CLEANUP_GRACE_MS } from "./cleanup.js"
import { assertRuntimeEnv, env } from "./config/env.js"
import { sendJson } from "./http.js"
import { createJobLanes, type JobQueue } from "./jobs.js"
import {
  createDevotionalArtifactsRoute,
  type DevotionalArtifactsRouteOptions,
} from "./routes/devotional-artifacts.js"
import { createJobsRoute, type JobsRouteOptions } from "./routes/jobs.js"

export type ServerDependencies = {
  queue?: JobQueue
  auth?: JobsRouteOptions["auth"]
  nodeEnv?: JobsRouteOptions["nodeEnv"]
  allowedSourceHosts?: JobsRouteOptions["allowedSourceHosts"]
  devotionalWorkspaceAllowedOrigin?: JobsRouteOptions["devotionalWorkspaceAllowedOrigin"]
  runDevotionalRenderImpl?: JobsRouteOptions["runDevotionalRenderImpl"]
  artifactStorage?: DevotionalArtifactsRouteOptions["storage"]
}

export function createHandleRequest(
  {
    queue = createJobLanes(),
    auth,
    nodeEnv,
    allowedSourceHosts,
    devotionalWorkspaceAllowedOrigin,
    runDevotionalRenderImpl,
    artifactStorage,
  }: ServerDependencies = {},
  isStopping = () => false,
) {
  const handleJobsRoute = createJobsRoute({
    queue,
    isStopping,
    auth,
    nodeEnv,
    allowedSourceHosts,
    devotionalWorkspaceAllowedOrigin,
    runDevotionalRenderImpl,
  })
  const handleDevotionalArtifactsRoute = createDevotionalArtifactsRoute({
    storage: artifactStorage,
    isStopping,
    auth,
  })

  return async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const method = request.method ?? "GET"
    const url = new URL(request.url ?? "/", "http://localhost")

    if (method === "GET" && url.pathname === "/health") {
      sendJson(response, isStopping() ? 503 : 200, {
        ok: !isStopping(),
        service: "shorts-worker",
      })
      return
    }

    if (await handleDevotionalArtifactsRoute(request, response, url)) {
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
        `[shorts-worker] event=request_failed message=${JSON.stringify(message)}`,
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

export type ShutdownResult = "drained" | "deadline-exceeded" | "failed"
export const SHUTDOWN_GRACE_MS = WORKER_CLEANUP_GRACE_MS

export function createWorkerServer(
  dependencies: ServerDependencies = {},
  onShutdown?: (result: ShutdownResult) => void,
) {
  let failShutdown: (() => void) | undefined
  const queue =
    dependencies.queue ??
    createJobLanes({
      onCleanupFailure: () => {
        // Ordinary-job cleanup has already failed or exhausted its grace. Do not
        // grant another window; fail the service and let PID1 retire all children.
        void stop()
        failShutdown?.()
      },
    })
  let stopping = false
  let shutdown: Promise<ShutdownResult> | undefined
  const listener = createRequestListener(
    createHandleRequest({ ...dependencies, queue }, () => stopping),
  )
  const requests = new Set<Promise<void>>()
  const server = createServer((request, response) => {
    const task = listener(request, response)
    requests.add(task)
    void task.then(() => requests.delete(task))
  })
  function stop(): Promise<ShutdownResult> {
    if (shutdown) return shutdown
    stopping = true
    const deadline = performance.now() + SHUTDOWN_GRACE_MS
    let settle!: (result: ShutdownResult) => void
    // Publish identity before cancellation invokes synchronous abort listeners.
    shutdown = new Promise<ShutdownResult>((resolve) => {
      settle = resolve
    })
    let settled = false
    const finish = (result: ShutdownResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (result !== "drained") server.closeAllConnections()
      settle(result)
      onShutdown?.(result)
    }
    failShutdown = () => finish("failed")
    // One deadline covers executor finally blocks and HTTP closure.
    const timer = setTimeout(
      () => finish("deadline-exceeded"),
      SHUTDOWN_GRACE_MS,
    )
    const closed = new Promise<void>((done, reject) => {
      if (!server.listening) {
        done()
        return
      }
      server.close((error) => (error ? reject(error) : done()))
    })
    void Promise.all([
      queue.shutdown(),
      closed.then(() => Promise.all(requests)),
    ]).then(
      () =>
        finish(performance.now() < deadline ? "drained" : "deadline-exceeded"),
      () => finish("failed"),
    )
    return shutdown
  }
  return { server, shutdown: stop }
}

export function startServer(port = env.PORT): void {
  assertRuntimeEnv()
  const worker = createWorkerServer({}, (result) => {
    console.log(`[shorts-worker] event=shutdown result=${result}`)
    process.exit(result === "drained" ? 0 : 1)
  })
  let signalled = false
  const stop = () => {
    if (signalled) return
    signalled = true
    void worker.shutdown()
  }
  process.on("SIGTERM", stop)
  process.on("SIGINT", stop)
  worker.server.listen(port, () =>
    console.log(`shorts-worker listening on :${port}`),
  )
}

if (env.NODE_ENV !== "test") startServer()
