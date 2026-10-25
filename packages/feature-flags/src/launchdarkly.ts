import {
  init,
  type LDContext,
  type LDOptions,
} from "@launchdarkly/node-server-sdk"

import {
  type FeatureFlagDefinition,
  type FeatureFlagEnv,
  type FeatureFlagKey,
  parseBooleanOverride,
  resolveLocalBooleanFallback,
} from "./registry"

export type FeatureFlagAttribute = string | number | boolean | null | undefined

export type FeatureFlagContext = {
  kind: string
  key: string
  name?: string
  email?: string
  anonymous?: boolean
  custom?: Record<string, FeatureFlagAttribute>
}

export type LaunchDarklyEvaluationDetailLike = {
  value: unknown
  reason?: { kind: string; errorKind?: string }
}

export type LaunchDarklyClientLike = {
  waitForInitialization(options: { timeout: number }): Promise<unknown>
  variation(
    flagKey: string,
    context: LDContext,
    defaultValue: boolean,
  ): Promise<unknown>
  boolVariationDetail(
    flagKey: string,
    context: LDContext,
    defaultValue: boolean,
  ): Promise<LaunchDarklyEvaluationDetailLike>
}

export type FeatureFlagClientOptions = {
  sdkKey?: string
  localEnv?: FeatureFlagEnv
  defaultValues?: Partial<Record<FeatureFlagKey, boolean>>
  timeoutSeconds?: number
  initializationFailureCooldownMs?: number
  options?: LDOptions
  initClient?: (sdkKey: string, options?: LDOptions) => LaunchDarklyClientLike
  logger?: Pick<Console, "warn">
}

export type FeatureFlagVariationSource = "launchdarkly" | "override" | "default"

export type BooleanVariationDetail = {
  value: boolean
  source: FeatureFlagVariationSource
}

export type FeatureFlagClient = {
  booleanVariation(
    flag: FeatureFlagDefinition,
    context: FeatureFlagContext,
  ): Promise<boolean>
  booleanVariationDetail(
    flag: FeatureFlagDefinition,
    context: FeatureFlagContext,
  ): Promise<BooleanVariationDetail>
}

const DEFAULT_TIMEOUT_SECONDS = 0.25
const DEFAULT_INITIALIZATION_FAILURE_COOLDOWN_MS = 30_000

const clientCache = new Map<string, LaunchDarklyClientLike>()
const readyPromises = new Map<string, Promise<void>>()
const initializationFailureRetryAt = new Map<string, number>()
const RESERVED_CONTEXT_ATTRIBUTES = new Set([
  "anonymous",
  "email",
  "key",
  "kind",
  "name",
])

function defaultInitClient(
  sdkKey: string,
  options?: LDOptions,
): LaunchDarklyClientLike {
  return init(sdkKey, options) as unknown as LaunchDarklyClientLike
}

function getClient(
  sdkKey: string,
  options: FeatureFlagClientOptions,
): LaunchDarklyClientLike {
  const cached = clientCache.get(sdkKey)
  if (cached) return cached

  const client = (options.initClient ?? defaultInitClient)(
    sdkKey,
    options.options,
  )
  clientCache.set(sdkKey, client)
  return client
}

async function waitUntilReady(
  sdkKey: string,
  client: LaunchDarklyClientLike,
  timeoutSeconds: number,
): Promise<void> {
  const cached = readyPromises.get(sdkKey)
  if (cached) return cached

  const readyPromise = client
    .waitForInitialization({ timeout: timeoutSeconds })
    .then(() => {
      initializationFailureRetryAt.delete(sdkKey)
      return undefined
    })
    .catch((error: unknown) => {
      readyPromises.delete(sdkKey)
      throw error
    })

  readyPromises.set(sdkKey, readyPromise)
  return readyPromise
}

function toLaunchDarklyContext(context: FeatureFlagContext): LDContext {
  const ldContext: LDContext = {
    kind: context.kind,
    key: context.key,
  }

  if (context.name) ldContext.name = context.name
  if (context.email) ldContext.email = context.email
  if (typeof context.anonymous === "boolean") {
    ldContext.anonymous = context.anonymous
  }

  if (context.custom) {
    for (const [key, value] of Object.entries(context.custom)) {
      if (value !== undefined && !RESERVED_CONTEXT_ATTRIBUTES.has(key)) {
        ldContext[key] = value
      }
    }
  }

  return ldContext
}

function resolveFallbackDetail(
  flag: FeatureFlagDefinition,
  localEnv: FeatureFlagEnv,
  defaultValues?: Partial<Record<FeatureFlagKey, boolean>>,
): BooleanVariationDetail {
  const parsed = parseBooleanOverride(localEnv[flag.localOverrideEnv])
  return {
    value: resolveLocalBooleanFallback(flag, localEnv, defaultValues),
    source: parsed.ok ? "override" : "default",
  }
}

function warn(
  logger: Pick<Console, "warn"> | undefined,
  message: string,
  error?: unknown,
): void {
  if (!logger) return
  if (error) {
    logger.warn(message, error)
    return
  }
  logger.warn(message)
}

export function createFeatureFlagClient(
  options: FeatureFlagClientOptions = {},
): FeatureFlagClient {
  const sdkKey = options.sdkKey?.trim()
  const timeoutSeconds = options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS
  const initializationFailureCooldownMs =
    options.initializationFailureCooldownMs ??
    DEFAULT_INITIALIZATION_FAILURE_COOLDOWN_MS
  const localEnv = options.localEnv ?? {}
  const logger = options.logger

  async function booleanVariationDetail(
    flag: FeatureFlagDefinition,
    context: FeatureFlagContext,
  ): Promise<BooleanVariationDetail> {
    const fallback = resolveFallbackDetail(
      flag,
      localEnv,
      options.defaultValues,
    )

    if (!sdkKey) return fallback

    // Respect the init-failure cooldown before touching the client at all, so a
    // persistently-throwing construction backs off like an init timeout rather
    // than re-attempting every request.
    const retryAt = initializationFailureRetryAt.get(sdkKey)
    if (retryAt && Date.now() < retryAt) return fallback

    // Client construction (SDK init) throwing must fail closed — this variant's
    // contract (KTD4) is that it never throws, and both gate surfaces await it
    // without a catch of their own.
    let client: LaunchDarklyClientLike
    try {
      client = getClient(sdkKey, options)
    } catch (error) {
      initializationFailureRetryAt.set(
        sdkKey,
        Date.now() + initializationFailureCooldownMs,
      )
      warn(
        logger,
        `[feature-flags] LaunchDarkly client init failed for ${flag.key}; using fallback.`,
        error,
      )
      return fallback
    }

    try {
      await waitUntilReady(sdkKey, client, timeoutSeconds)
    } catch (error) {
      initializationFailureRetryAt.set(
        sdkKey,
        Date.now() + initializationFailureCooldownMs,
      )
      warn(
        logger,
        `[feature-flags] LaunchDarkly initialization failed for ${flag.key}; using fallback.`,
        error,
      )
      return fallback
    }

    try {
      const detail = await client.boolVariationDetail(
        flag.key,
        toLaunchDarklyContext(context),
        fallback.value,
      )
      // The SDK resolves the passed default (never throws) on in-LD errors
      // such as a missing/archived flag; treat those as fallback, not as a
      // genuine LaunchDarkly answer.
      if (detail.reason?.kind === "ERROR") {
        warn(
          logger,
          `[feature-flags] LaunchDarkly resolved ${flag.key} with an error reason (${detail.reason.errorKind ?? "unknown"}); using fallback.`,
        )
        return fallback
      }
      return typeof detail.value === "boolean"
        ? { value: detail.value, source: "launchdarkly" }
        : fallback
    } catch (error) {
      warn(
        logger,
        `[feature-flags] LaunchDarkly variation failed for ${flag.key}; using fallback.`,
        error,
      )
      return fallback
    }
  }

  return {
    booleanVariationDetail,
    async booleanVariation(flag, context) {
      const { value } = await booleanVariationDetail(flag, context)
      return value
    },
  }
}

export async function evaluateFlag(
  flag: FeatureFlagDefinition,
  context: FeatureFlagContext,
  options: FeatureFlagClientOptions = {},
): Promise<boolean> {
  return createFeatureFlagClient(options).booleanVariation(flag, context)
}

export async function evaluateFlagDetail(
  flag: FeatureFlagDefinition,
  context: FeatureFlagContext,
  options: FeatureFlagClientOptions = {},
): Promise<BooleanVariationDetail> {
  return createFeatureFlagClient(options).booleanVariationDetail(flag, context)
}

export function resetFeatureFlagClientCacheForTests(): void {
  clientCache.clear()
  readyPromises.clear()
  initializationFailureRetryAt.clear()
}
