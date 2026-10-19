import { hostname } from "node:os"

// DogStatsD custom metrics reach Datadog through the shared private agent, so
// every series carries the agent's `host` tag and dd-trace drops `runtime-id`
// from metrics by default. Without an explicit per-instance tag, two Web
// replicas (or an old and a new process overlapping during a deploy) of the
// same version write the same gauge series and overwrite each other (feat-745).
//
// `RAILWAY_REPLICA_ID` is the id Railway's HTTP logs report as
// `deploymentInstanceId`, so a gauge series joins directly to the request log
// of the instance it describes. Cardinality is one series per replica per
// deployment. The container hostname is the fallback outside Railway.

export type InstanceIdentity = {
  replicaId: string
  deploymentId?: string
}

type Env = Record<string, string | undefined>

const TAG_VALUE_PATTERN = /[^a-z0-9_.:/-]/gi
const MAX_TAG_VALUE_LENGTH = 64

function tagValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  return trimmed
    .replaceAll(TAG_VALUE_PATTERN, "_")
    .slice(0, MAX_TAG_VALUE_LENGTH)
}

export function resolveInstanceIdentity(
  env: Env = process.env,
  fallbackHostname: () => string = hostname,
): InstanceIdentity {
  const replicaId =
    tagValue(env.RAILWAY_REPLICA_ID) ??
    tagValue(fallbackHostname()) ??
    "unknown"
  const deploymentId = tagValue(env.RAILWAY_DEPLOYMENT_ID)
  return deploymentId ? { replicaId, deploymentId } : { replicaId }
}

export function instanceTags(
  identity: InstanceIdentity,
): Record<string, string> {
  return identity.deploymentId
    ? { replica_id: identity.replicaId, deployment_id: identity.deploymentId }
    : { replica_id: identity.replicaId }
}
