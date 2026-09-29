export type CollectorInterval = {
  deployment_id: string
  started_at: Date
  complete_through: Date
  stopped_at: Date | null
}
export type DeploymentInterval = {
  deployment_id: string
  starts_at: Date
  ends_at: Date | null
  expected_replicas: number
}
/** Partition at every membership boundary so an overlapping healthy replica cannot hide a missing one. */
export function inventoryCovers(
  from: Date,
  to: Date,
  collectors: CollectorInterval[],
  deployments: DeploymentInterval[],
): boolean {
  const start = from.getTime(),
    end = to.getTime()
  const boundaries = [
    ...new Set([
      start,
      end,
      ...collectors.flatMap((c) => [
        c.started_at.getTime(),
        c.stopped_at?.getTime() ?? end,
      ]),
      ...deployments.flatMap((d) => [
        d.starts_at.getTime(),
        d.ends_at?.getTime() ?? end,
      ]),
    ]),
  ]
    .filter((at) => at >= start && at <= end)
    .sort((a, b) => a - b)
  for (let i = 0; i < boundaries.length - 1; i++) {
    const left = boundaries[i],
      right = boundaries[i + 1]
    const expected = deployments.filter(
      (d) =>
        d.starts_at.getTime() <= left && (d.ends_at?.getTime() ?? end) >= right,
    )
    if (!expected.length) return false
    const participating = collectors.filter(
      (c) =>
        c.started_at.getTime() <= left &&
        (c.stopped_at?.getTime() ?? end) >= right,
    )
    if (
      participating.some(
        (c) => !expected.some((d) => d.deployment_id === c.deployment_id),
      )
    )
      return false
    for (const deployment of expected) {
      const replicas = participating.filter(
        (c) => c.deployment_id === deployment.deployment_id,
      )
      if (
        replicas.length !== deployment.expected_replicas ||
        replicas.some((c) => c.complete_through.getTime() < right)
      )
        return false
    }
  }
  return true
}
