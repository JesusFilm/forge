import { workerData, type MessagePort } from "node:worker_threads"
import {
  runRedisAdmission,
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
    if (performance.timeOrigin + performance.now() < request.deadlineAt) {
      result = await runRedisAdmission(
        request.clientKey,
        request.aggregateKey,
        request.namespace,
        { deadlineAt: request.deadlineAt },
      ).catch(() => null)
    }
    port.postMessage({
      id: request.id,
      result,
      finishedAt: performance.timeOrigin + performance.now(),
    })
  },
)
