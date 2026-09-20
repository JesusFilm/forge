import type { PushCampaignStatus } from "@prisma/client"

export type PushServiceErrorCode =
  | "invalid_input"
  | "not_found"
  | "not_tested"
  | "frozen"
  | "invalid_transition"
  | "duplicate_test_device"
  | "token_shaped_id"
  | "unknown_time_zone"

export class PushServiceError extends Error {
  constructor(
    readonly code: PushServiceErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "PushServiceError"
  }
}

export class PushInputError extends PushServiceError {
  constructor(message: string) {
    super("invalid_input", message)
    this.name = "PushInputError"
  }
}

export class PushNotFoundError extends PushServiceError {
  constructor(message: string) {
    super("not_found", message)
    this.name = "PushNotFoundError"
  }
}

/** R10 — no campaign schedules or sends before a test send reached a phone. */
export class PushNotTestedError extends PushServiceError {
  constructor(readonly status: PushCampaignStatus) {
    super(
      "not_tested",
      "Send this campaign to a test device before you schedule or send it",
    )
    this.name = "PushNotTestedError"
  }
}

/** R11 — copy, destination, and audience freeze once sending starts. */
export class PushFrozenError extends PushServiceError {
  constructor(readonly status: PushCampaignStatus) {
    super(
      "frozen",
      `A campaign in status ${status} is frozen; cancel it instead of editing it`,
    )
    this.name = "PushFrozenError"
  }
}

/**
 * The expected prior status did not match, so the conditional update moved no
 * row. `from` is the status read back, which is null when the row is gone.
 */
export class PushInvalidTransitionError extends PushServiceError {
  constructor(
    readonly from: PushCampaignStatus | null,
    readonly to: PushCampaignStatus,
  ) {
    super(
      "invalid_transition",
      `A campaign in status ${from ?? "unknown"} cannot move to ${to}`,
    )
    this.name = "PushInvalidTransitionError"
  }
}

export class PushDuplicateTestDeviceError extends PushServiceError {
  constructor(readonly existingLabel: string) {
    super(
      "duplicate_test_device",
      `That test ID is already on the list as "${existingLabel}"`,
    )
    this.name = "PushDuplicateTestDeviceError"
  }
}

/** R31 — the test ID is a separate identifier and never the push token. */
export class PushTokenShapedIdError extends PushServiceError {
  constructor() {
    super(
      "token_shaped_id",
      "That looks like a push token; paste the notification test ID from the app's Profile screen",
    )
    this.name = "PushTokenShapedIdError"
  }
}

export class PushUnknownTimeZoneError extends PushServiceError {
  constructor(readonly timeZone: string) {
    super("unknown_time_zone", `The time zone ${timeZone} is not known`)
    this.name = "PushUnknownTimeZoneError"
  }
}
