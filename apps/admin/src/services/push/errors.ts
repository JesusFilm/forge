import type { PushCampaignStatus, PushDestinationKind } from "@prisma/client"

export type PushServiceErrorCode =
  | "invalid_input"
  | "not_found"
  | "not_tested"
  | "frozen"
  | "invalid_transition"
  | "duplicate_test_device"
  | "token_shaped_id"
  | "unknown_time_zone"
  | "admission_denied"
  | "viewer_handle_rejected"
  | "ceiling_exceeded"
  | "invalid_token_status"
  | "campaigns_disabled"
  | "run_already_active"
  | "transport_unconfigured"
  | "provider_retryable"
  | "provider_indeterminate"
  | "provider_fatal"
  | "provider_auth"
  | "unknown_language"
  | "unknown_destination"
  | "stale_content_version"
  | "too_many_rows"

export class PushServiceError extends Error {
  constructor(
    readonly code: PushServiceErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "PushServiceError"
  }
}

/** R14 — one field to fix. It names the field and never the rejected value. */
export type PushInputIssue = Readonly<{ path: string; message: string }>

export class PushInputError extends PushServiceError {
  constructor(
    message: string,
    readonly issues: readonly PushInputIssue[] = [],
  ) {
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
      "That looks like a push token; paste the notification test ID from the app instead",
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

/** KTD7 — the push write predicate refused the caller. */
export class PushAdmissionError extends PushServiceError {
  constructor(message = "A push write needs the consumer bearer") {
    super("admission_denied", message)
    this.name = "PushAdmissionError"
  }
}

/**
 * KTD7 — a well-formed viewer handle that Admin no longer accepts. It has its
 * own code so the app re-checks the handle instead of sending it again.
 */
export class PushViewerHandleRejectedError extends PushServiceError {
  constructor() {
    super("viewer_handle_rejected", "That viewer handle did not verify")
    this.name = "PushViewerHandleRejectedError"
  }
}

/** KTD7 — the fleet key passed its per-minute ceiling for this operation. */
export class PushCeilingExceededError extends PushServiceError {
  constructor(readonly operation: "register" | "open") {
    super("ceiling_exceeded", `Too many push ${operation} requests this minute`)
    this.name = "PushCeilingExceededError"
  }
}

/**
 * KTD4 — invalid is terminal. The provider reported this token dead, so the
 * phone must stop asking. Retention deletes the row 90 days later, after
 * which the same token registers again as a new row.
 */
export class PushInvalidTokenStatusError extends PushServiceError {
  constructor() {
    super(
      "invalid_token_status",
      "That push token is retired; do not register it again",
    )
    this.name = "PushInvalidTokenStatusError"
  }
}

/** KTD12 — the campaign kill switch is off, so nothing schedules or sends. */
export class PushCampaignsDisabledError extends PushServiceError {
  constructor() {
    super(
      "campaigns_disabled",
      "Push campaigns are turned off; set PUSH_CAMPAIGNS_ENABLED=true to send",
    )
    this.name = "PushCampaignsDisabledError"
  }
}

/**
 * KTD2 — one bounded run per campaign, so a second dispatch is refused. A test
 * in flight replaces the message with its receipt window (KTD17).
 */
export class PushRunAlreadyActiveError extends PushServiceError {
  constructor(
    readonly workflowRunLogId: string,
    message = "This campaign already has a run in flight; cancel it before you start another",
  ) {
    super("run_already_active", message)
    this.name = "PushRunAlreadyActiveError"
  }
}

/**
 * KTD1 — the transport refuses to construct without the project access token
 * in production, so boot never fails but no unauthenticated send is possible.
 */
export class PushTransportConfigurationError extends PushServiceError {
  constructor(message: string) {
    super("transport_unconfigured", message)
    this.name = "PushTransportConfigurationError"
  }
}

/**
 * KTD1 and KTD3 — a provider failure carrying the provider's error code and
 * nothing else. The provider's message embeds the push token, so it never
 * reaches this class, a delivery row, or a log line.
 */
export class PushProviderError extends PushServiceError {
  constructor(
    code: PushServiceErrorCode,
    readonly providerCode: string,
  ) {
    super(code, `The push provider answered ${providerCode}`)
    this.name = "PushProviderError"
  }
}

/** The request never left, so the caller reverts the chunk and retries. */
export class PushProviderRetryableError extends PushProviderError {
  constructor(providerCode: string) {
    super("provider_retryable", providerCode)
    this.name = "PushProviderRetryableError"
  }
}

/**
 * The request may have left. The caller leaves the chunk at sending, so the
 * receipt step resolves it as unknown: loss is accepted and duplication is not.
 */
export class PushProviderIndeterminateError extends PushProviderError {
  constructor(providerCode: string) {
    super("provider_indeterminate", providerCode)
    this.name = "PushProviderIndeterminateError"
  }
}

/** The chunk can never succeed as written, so every row in it fails. */
export class PushProviderFatalError extends PushProviderError {
  constructor(
    providerCode: string,
    code: PushServiceErrorCode = "provider_fatal",
  ) {
    super(code, providerCode)
    this.name = "PushProviderFatalError"
  }
}

/** Bad credentials. Fatal for the chunk, and an operator alert. */
export class PushProviderAuthError extends PushProviderFatalError {
  constructor(providerCode: string) {
    super(providerCode, "provider_auth")
    this.name = "PushProviderAuthError"
  }
}

/** R12 and R31 — a written slug that is not a live Language with a slug. */
export class PushUnknownLanguageError extends PushServiceError {
  constructor(readonly slugs: readonly string[]) {
    super(
      "unknown_language",
      `Admin does not know these languages: ${slugs.join(", ")}`,
    )
    this.name = "PushUnknownLanguageError"
  }
}

/**
 * R32 and KTD9 — no row of the named kind carries the slug. `actualKind` is
 * the kind that does carry it, or null when no kind does.
 */
export class PushUnknownDestinationError extends PushServiceError {
  readonly kind: PushDestinationKind
  readonly slug: string
  readonly actualKind: PushDestinationKind | null

  constructor(input: {
    kind: PushDestinationKind
    slug: string
    actualKind: PushDestinationKind | null
  }) {
    super(
      "unknown_destination",
      input.actualKind
        ? `No ${input.kind} has the slug ${input.slug}; that slug is a ${input.actualKind}`
        : `No ${input.kind} has the slug ${input.slug}`,
    )
    this.name = "PushUnknownDestinationError"
    this.kind = input.kind
    this.slug = input.slug
    this.actualKind = input.actualKind
  }
}

/**
 * R34 and KTD4 — the content changed after the caller read it. The fields
 * name the newer change, so the caller can say who made it and when.
 */
export class PushStaleContentVersionError extends PushServiceError {
  readonly currentContentVersion: number
  readonly lastActorId: string | null
  readonly updatedAt: Date

  constructor(input: {
    currentContentVersion: number
    lastActorId: string | null
    updatedAt: Date
  }) {
    super(
      "stale_content_version",
      `This campaign changed after you loaded it: version ${input.currentContentVersion} was saved at ${input.updatedAt.toISOString()}. Load the newer version, then make your change again.`,
    )
    this.name = "PushStaleContentVersionError"
    this.currentContentVersion = input.currentContentVersion
    this.lastActorId = input.lastActorId
    this.updatedAt = input.updatedAt
  }
}

/** KTD7 — the merged copy set would hold more rows than a campaign takes. */
export class PushTooManyCopyRowsError extends PushServiceError {
  constructor(
    readonly rowCount: number,
    readonly limit: number,
  ) {
    super(
      "too_many_rows",
      `A campaign holds at most ${limit} copy rows; this change would leave ${rowCount}`,
    )
    this.name = "PushTooManyCopyRowsError"
  }
}
