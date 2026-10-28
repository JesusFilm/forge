import { workerData, type MessagePort } from "node:worker_threads"
import {
  observeAdmissionFailure,
  runRedisAdmission,
  type AdmissionWorkerDiagnostic,
  type RecommendationAdmissionNamespace,
} from "./recommendation-redis-admission.js"

const port: MessagePort = workerData.port
port.on(
  "message",
  async (request: {
    id: number
    clientKey: string
    aggregateKey: string
    namespace: RecommendationAdmissionNamespace
    deadlineAt: number
  }) => {
    let result = null
    let diagnostic: AdmissionWorkerDiagnostic | undefined
    const reportFailure: typeof observeAdmissionFailure = (
      stage,
      reason,
      elapsedMs,
      budgetMs,
    ) => {
      diagnostic ??= { stage, reason }
      observeAdmissionFailure(stage, reason, elapsedMs, budgetMs)
    }
    if (performance.timeOrigin + performance.now() < request.deadlineAt) {
      try {
        result = await runRedisAdmission(
          request.clientKey,
          request.aggregateKey,
          request.namespace,
          { deadlineAt: request.deadlineAt, reportFailure },
        )
        if (
          !diagnostic &&
          (!result ||
            (!result.allowed && result.reason === "admission_unavailable"))
        ) {
          diagnostic = { stage: "worker", reason: "redis_unavailable" }
        }
      } catch {
        diagnostic = { stage: "worker", reason: "worker_exception" }
      }
    } else {
      diagnostic = { stage: "worker", reason: "deadline_before_start" }
    }
    port.postMessage({
      id: request.id,
      result,
      diagnostic,
      finishedAt: performance.timeOrigin + performance.now(),
    })
  },
)
