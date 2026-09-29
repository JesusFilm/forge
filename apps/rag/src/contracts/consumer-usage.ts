import { z } from "zod"
export class UsageError extends Error {
  override readonly name = "UsageError"
  constructor(
    readonly code: "invalid_window" | "unknown_consumer" | "unavailable",
  ) {
    super(code)
  }
}
export type UsageWindow = { consumerId: string; from: Date; to: Date }
export type UsageReport = {
  consumerId: string
  label: string
  windowStart: string
  windowEnd: string
  requestCount: number
  successfulRequestCount: number
  lastActivityAt: string | null
  generatedAt: string
}
export type ServiceDenial =
  | "unauthorized"
  | "auth_unavailable"
  | "body_limit"
  | "legacy_unattributed"
export type UsageWriter = {
  admit(consumerId: string, at: Date): Promise<string>
  complete(attempt: string, successful: boolean): Promise<void>
  denial(reason: ServiceDenial, at: Date): Promise<void>
}
export type UsageReader = {
  report(window: UsageWindow, now?: Date): Promise<UsageReport>
}
/** Minute aggregates require aligned UTC boundaries; at most 31 days per read. */
export function validateUsageWindow(window: UsageWindow): void {
  const from = window.from.getTime(),
    to = window.to.getTime()
  if (
    !z.string().uuid().safeParse(window.consumerId).success ||
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from % 60000 ||
    to % 60000 ||
    to <= from ||
    to - from > 31 * 86400000
  )
    throw new UsageError("invalid_window")
}

export const usageReportSchema = z
  .object({
    consumerId: z.string().uuid(),
    label: z.string().regex(/^[a-z0-9-]{1,80}$/),
    windowStart: z.iso.datetime(),
    windowEnd: z.iso.datetime(),
    requestCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    successfulRequestCount: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    lastActivityAt: z.iso.datetime().nullable(),
    generatedAt: z.iso.datetime(),
  })
  .strict()
