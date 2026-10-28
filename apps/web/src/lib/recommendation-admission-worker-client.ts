import { resolve } from "node:path"
import {
  MessageChannel,
  receiveMessageOnPort,
  type Worker,
  type MessagePort,
} from "node:worker_threads"
import {
  COMMAND_TIMEOUT_MS,
  observeAdmissionFailure,
  PLAYBACK_CONTEXT_COMMAND_TIMEOUT_MS,
  type AdmissionFailureReason,
  type AdmissionWorkerDiagnostic,
  type RecommendationAdmissionNamespace,
  type RecommendationMutationAdmissionResult,
} from "./recommendation-redis-admission"

const unavailable = (): RecommendationMutationAdmissionResult => ({
  allowed: false,
  reason: "admission_unavailable",
})
const absoluteNow = () => performance.timeOrigin + performance.now()

type Pending = {
  deadlineAt: number
  timer: ReturnType<typeof setTimeout>
  resolve: (outcome: AdmissionOutcome) => void
}

type AdmissionOutcome = {
  result: RecommendationMutationAdmissionResult
  diagnostic: AdmissionWorkerDiagnostic | null
}

const failed = (diagnostic: AdmissionFailureReason): AdmissionOutcome => ({
  result: unavailable(),
  diagnostic: { stage: "worker", reason: diagnostic },
})

export function createAdmissionWorkerClient({
  workerFile = resolve(
    process.cwd(),
    ".next/admission-worker/recommendation-admission-worker.js",
  ),
  redisUrl = process.env.REDIS_URL,
  maxPending = 128,
} = {}) {
  let worker: Worker | null = null
  let port: MessagePort | null = null
  let nextId = 0
  let retryAt = 0
  let retiring = false
  const pending = new Map<number, Pending>()

  function destroy() {
    const current = worker
    worker = null
    port?.close()
    port = null
    retiring = false
    void current?.terminate()
  }

  function settle(id: number, outcome: AdmissionOutcome) {
    const item = pending.get(id)
    if (!item) return
    clearTimeout(item.timer)
    pending.delete(id)
    item.resolve(outcome)
    if (pending.size === 0) {
      if (retiring) destroy()
      else {
        worker?.unref()
        port?.unref()
      }
    }
  }

  function receive(message: {
    id: number
    result: RecommendationMutationAdmissionResult | null
    finishedAt: number
    diagnostic?: AdmissionWorkerDiagnostic
  }) {
    const item = pending.get(message.id)
    if (!item) return
    const onTime =
      Number.isFinite(message.finishedAt) &&
      message.finishedAt <= item.deadlineAt
    if (!onTime) {
      settle(message.id, failed("worker_late_result"))
    } else if (!message.result) {
      settle(
        message.id,
        message.diagnostic
          ? { result: unavailable(), diagnostic: message.diagnostic }
          : failed("worker_no_result"),
      )
    } else {
      settle(message.id, {
        result: message.result,
        diagnostic:
          !message.result.allowed &&
          message.result.reason === "admission_unavailable"
            ? (message.diagnostic ?? {
                stage: "worker",
                reason: "redis_unavailable",
              })
            : null,
      })
    }
  }

  function start() {
    const channel = new MessageChannel()
    port = channel.port1
    // This Node worker is compiled separately after next build. Resolve its
    // constructor at runtime so Turbopack does not bundle it as a Web Worker.
    const NodeWorker = process.getBuiltinModule("node:worker_threads").Worker
    const current = new NodeWorker(workerFile, {
      workerData: { port: channel.port2 },
      transferList: [channel.port2],
      env: { REDIS_URL: redisUrl ?? "" },
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    })
    worker = current
    port.on("message", receive)
    const fail = (
      reason: "worker_error" | "worker_exit",
      exitCode?: number,
    ) => {
      if (worker !== current) return
      // An idle worker can exit with no HTTP caller to carry a failure log.
      // Keep lifecycle fields numeric or fixed strings; never log Error text.
      try {
        console.info(
          `event=recommendation.admission_worker reason=${reason} exitCode=${Number.isInteger(exitCode) ? exitCode : "unknown"} pendingCount=${pending.size}`,
        )
      } catch {
        // Diagnostics must not change admission behavior.
      }
      retryAt = Date.now() + 1_000
      for (const id of pending.keys()) settle(id, failed(reason))
      destroy()
    }
    current.on("error", () => fail("worker_error"))
    current.on("exit", (code) => fail("worker_exit", code))
  }

  return {
    admit(
      clientKey: string,
      aggregateKey: string,
      namespace: RecommendationAdmissionNamespace,
    ): Promise<RecommendationMutationAdmissionResult> {
      const refused: AdmissionFailureReason | null = !redisUrl
        ? "redis_missing"
        : retiring
          ? "worker_retiring"
          : Date.now() < retryAt
            ? "retry_backoff"
            : pending.size >= maxPending
              ? "pending_capacity"
              : null
      if (refused) {
        observeAdmissionFailure("worker", refused)
        return Promise.resolve(unavailable())
      }
      const totalBudget =
        COMMAND_TIMEOUT_MS +
        (namespace === "playback-context"
          ? PLAYBACK_CONTEXT_COMMAND_TIMEOUT_MS
          : COMMAND_TIMEOUT_MS)
      const deadlineAt = absoluteNow() + totalBudget
      const id = ++nextId
      return new Promise<AdmissionOutcome>((resolveResult) => {
        const timer = setTimeout(() => {
          // A blocked page-rendering loop can run timers before queued message
          // callbacks. Read already-completed results before declaring timeout.
          if (port) {
            let queued
            while (port && (queued = receiveMessageOnPort(port)))
              receive(queued.message)
          }
          if (!pending.has(id)) return
          retiring = true
          retryAt = Date.now() + 1_000
          settle(id, failed("worker_timeout"))
        }, totalBudget)
        pending.set(id, {
          deadlineAt,
          timer,
          resolve: resolveResult,
        })
        try {
          if (!worker) start()
          worker?.ref()
          port?.ref()
          port?.postMessage({
            id,
            clientKey,
            aggregateKey,
            namespace,
            deadlineAt,
          })
        } catch {
          retiring = true
          retryAt = Date.now() + 1_000
          settle(id, failed("worker_dispatch_error"))
        }
      }).then(({ result, diagnostic }) => {
        // This continuation belongs to the calling HTTP request, unlike the
        // shared MessagePort listener created by the worker's first caller.
        if (!result.allowed && result.reason === "admission_unavailable") {
          observeAdmissionFailure(
            diagnostic?.stage ?? "worker",
            diagnostic?.reason ?? "unavailable",
            absoluteNow() - (deadlineAt - totalBudget),
            totalBudget,
          )
        }
        return result
      })
    },
    close() {
      for (const id of pending.keys()) settle(id, failed("worker_closed"))
      destroy()
    },
  }
}

type WorkerClient = ReturnType<typeof createAdmissionWorkerClient>
const workerState = globalThis as typeof globalThis & {
  forgeRecommendationAdmissionWorker?: WorkerClient
}

export function admitInWorker(
  clientKey: string,
  aggregateKey: string,
  namespace: RecommendationAdmissionNamespace,
): Promise<RecommendationMutationAdmissionResult> {
  workerState.forgeRecommendationAdmissionWorker ??=
    createAdmissionWorkerClient()
  return workerState.forgeRecommendationAdmissionWorker.admit(
    clientKey,
    aggregateKey,
    namespace,
  )
}
export function resetAdmissionWorkerForTests(): void {
  workerState.forgeRecommendationAdmissionWorker?.close()
  delete workerState.forgeRecommendationAdmissionWorker
}
