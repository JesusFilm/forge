import { z } from "zod"
import { studioCall } from "./client"
import { studioProductionListSchema } from "@forge/studio-contracts/production"
export class StudioProductionClientError extends Error {}
export async function production(input: unknown) {
  const response = await fetch("/api/shorts/production", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })
  const data = await response.json()
  if (!response.ok)
    throw new StudioProductionClientError(
      data.error ?? "Production request failed",
    )
  return data.result
}

const runSchema = z.object({
  id: z.string(),
  state: z.string(),
  label: z.string(),
  createdAt: z.string(),
  experimentId: z.string().nullable(),
})
export type ProductionRun = z.infer<typeof runSchema>
export async function readProductionRuns(
  input: z.input<typeof studioProductionListSchema>,
) {
  return z.array(runSchema).parse(await studioCall("production-list", input))
}
export function mergeProductionRuns(
  current: ProductionRun[],
  next: ProductionRun[],
) {
  return [
    ...new Map([...current, ...next].map((run) => [run.id, run])).values(),
  ].sort((a, b) =>
    a.createdAt === b.createdAt
      ? a.id < b.id
        ? 1
        : a.id > b.id
          ? -1
          : 0
      : a.createdAt < b.createdAt
        ? 1
        : -1,
  )
}
