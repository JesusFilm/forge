import { z } from "zod"

export const MINUTE = 60_000
export const SILENCE_MS = 120 * MINUTE
const MAX_GAP_MS = 15 * MINUTE

export type Observation = {
  status: "good" | "bad" | "unknown" | "waiting"
  detail: string
}

const StreakSchema = z.object({
  status: z.enum(["good", "bad"]),
  since: z.number().nonnegative(),
  last: z.number().nonnegative(),
  count: z.number().int().positive(),
})
const IncidentSchema = z.object({ id: z.string(), openedAt: z.number() })
const CheckStateSchema = z.object({
  streak: StreakSchema.optional(),
  incident: IncidentSchema.optional(),
})
const NotificationSchema = z.object({
  id: z.string(),
  check: z.string(),
  kind: z.enum(["opened", "recovered"]),
  incidentId: z.string(),
  at: z.number(),
  detail: z.string(),
})
export const StateSchema = z.object({
  version: z.literal(1),
  scope: z.string(),
  checks: z.record(z.string(), CheckStateSchema),
  outbox: z.array(NotificationSchema).max(100),
  ga: z
    .object({ lastQueryAt: z.number(), lastActivityAt: z.number() })
    .optional(),
})
export type State = z.infer<typeof StateSchema>
export type Notification = z.infer<typeof NotificationSchema>

export function emptyState(scope: string): State {
  return { version: 1, scope, checks: {}, outbox: [] }
}

function advance(
  state: State,
  check: string,
  result: Observation,
  now: number,
) {
  const current = (state.checks[check] ??= {})
  if (result.status === "unknown" || result.status === "waiting") {
    delete current.streak
    return
  }
  const previous = current.streak
  if (
    !previous ||
    previous.status !== result.status ||
    now <= previous.last ||
    now - previous.last > MAX_GAP_MS
  ) {
    current.streak = { status: result.status, since: now, last: now, count: 1 }
  } else {
    current.streak = { ...previous, last: now, count: previous.count + 1 }
  }
  const streak = current.streak
  if (
    result.status === "bad" &&
    !current.incident &&
    streak.count >= 3 &&
    now - streak.since >= 10 * MINUTE
  ) {
    const id = `${check}:${now}`
    current.incident = { id, openedAt: now }
    state.outbox.push({
      id,
      check,
      kind: "opened",
      incidentId: id,
      at: now,
      detail: result.detail,
    })
  }
  if (
    result.status === "good" &&
    current.incident &&
    streak.count >= 2 &&
    now - streak.since >= 5 * MINUTE
  ) {
    const incidentId = current.incident.id
    state.outbox.push({
      id: `${incidentId}:recovered`,
      check,
      kind: "recovered",
      incidentId,
      at: now,
      detail: result.detail,
    })
    delete current.incident
  }
}

export function recordObservation(
  state: State,
  check: string,
  result: Observation,
  now: number,
) {
  advance(state, check, result, now)
  advance(
    state,
    `${check}:visibility`,
    {
      status: result.status === "unknown" ? "bad" : "good",
      detail:
        result.status === "unknown"
          ? result.detail
          : "Monitoring access restored; analytics health is evaluated separately.",
    },
    now,
  )
}

// A query covers only 30 minutes. Missing runs/unknown queries cannot establish
// continuous silence across a gap, even if an old lastActivityAt was persisted.
export function recordGaActivity(
  state: State,
  latest: number | null,
  now: number,
): Observation {
  const previous = state.ga
  const continuous =
    previous &&
    now > previous.lastQueryAt &&
    now - previous.lastQueryAt <= MAX_GAP_MS
  const baseline = continuous ? previous.lastActivityAt : now - 29 * MINUTE
  const lastActivityAt = latest === null ? baseline : Math.max(baseline, latest)
  state.ga = { lastQueryAt: now, lastActivityAt }
  return now - lastActivityAt >= SILENCE_MS
    ? {
        status: "bad",
        detail:
          "No real GA page views observed in the configured stream for at least two hours of continuous monitoring.",
      }
    : {
        status: latest === null ? "waiting" : "good",
        detail:
          latest === null
            ? "GA returned no recent page views; the two-hour silence window is still being established."
            : `GA page views received within the last ${Math.ceil((now - latest) / MINUTE)} minutes.`,
      }
}
