import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"
import { env, assertRuntimeEnv } from "./config/env.js"
import { prisma } from "./db/client.js"
import { PrismaMatchJobRepository } from "./db/match-job.repository.js"
import { sendJson } from "./http.js"
import { createMatchJobsRoute } from "./routes/match-jobs.js"
import { MatchJobService } from "./services/match-job.service.js"
import {
  MediaSignatureMatcher,
  PrismaMediaSignatureMatchRepository,
} from "./services/media-signature-matcher.js"
import { FileSystemUploadStorage } from "./services/upload-storage.js"
import { DeterministicUploadSignalExtractor } from "./services/upload-signal-extraction.js"
import { startMatchJobWorker, type MatchJobWorker } from "./worker.js"

export type ServerDependencies = {
  matchJobService?: MatchJobService
  autoProcessMatchJobs?: boolean
  maxUploadBytes?: number
  apiToken?: string
}

export type ServerRuntimeOptions = ServerDependencies & {
  workerEnabled?: boolean
  startMatchJobWorkerImpl?: typeof startMatchJobWorker
}

export type ServerRuntime = {
  handleRequest: (
    request: IncomingMessage,
    response: ServerResponse,
  ) => Promise<void>
  worker: MatchJobWorker | null
}

export function createHandleRequest({
  matchJobService = createDefaultMatchJobService(),
  autoProcessMatchJobs = false,
  maxUploadBytes = env.MAX_UPLOAD_BYTES,
  apiToken = env.MAPPER_API_TOKEN,
}: ServerDependencies = {}) {
  const handleMatchJobsRoute = createMatchJobsRoute(matchJobService, {
    autoProcess: autoProcessMatchJobs,
    maxUploadBytes,
    apiToken,
  })

  return async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const method = request.method ?? "GET"
    const url = new URL(request.url ?? "/", "http://localhost")

    if (method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true, service: "yt-video-mapper-backend" })
      return
    }

    if (await handleMatchJobsRoute(request, response, url)) {
      return
    }

    sendJson(response, 404, { error: "not_found" })
  }
}

export const handleRequest = createHandleRequest()

export function createServerRuntime({
  matchJobService = createDefaultMatchJobService(),
  workerEnabled = env.MATCH_JOB_WORKER_ENABLED === "true",
  startMatchJobWorkerImpl = startMatchJobWorker,
  ...dependencies
}: ServerRuntimeOptions = {}): ServerRuntime {
  return {
    handleRequest: createHandleRequest({
      ...dependencies,
      matchJobService,
    }),
    worker: workerEnabled ? startMatchJobWorkerImpl(matchJobService) : null,
  }
}

export function startServer(port = env.PORT): void {
  assertRuntimeEnv()
  const runtime = createServerRuntime()

  createServer((request, response) => {
    void runtime.handleRequest(request, response).catch((error: unknown) => {
      console.error(error)
      sendJson(response, 500, { error: "internal_error" })
    })
  })
    .on("close", () => runtime.worker?.stop())
    .listen(port, () => {
      console.log(`yt-video-mapper-backend listening on :${port}`)
    })
}

export function createDefaultMatchJobService(): MatchJobService {
  return new MatchJobService(
    new PrismaMatchJobRepository(prisma),
    new FileSystemUploadStorage(env.UPLOAD_STORAGE_DIR),
    new DeterministicUploadSignalExtractor(),
    new MediaSignatureMatcher(new PrismaMediaSignatureMatchRepository(prisma), {
      algorithmVersion: env.MEDIA_SIGNATURE_ALGORITHM_VERSION,
    }),
  )
}

if (env.NODE_ENV !== "test") {
  startServer()
}
