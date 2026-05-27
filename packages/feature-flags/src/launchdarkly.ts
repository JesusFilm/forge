import {
  init,
  type LDContext,
  type LDOptions,
} from "@launchdarkly/node-server-sdk"

import {
  type FeatureFlagDefinition,
  type FeatureFlagEnv,
  type FeatureFlagKey,
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

export type LaunchDarklyClientLike = {
  waitForInitialization(options: { timeout: number }): Promise<unknown>
  variation(
    flagKey: string,
    context: LDContext,
    defaultValue: boolean,
  ): Promise<unknown>
}

export type FeatureFlagClientOptions = {
  sdkKey?: string
  localEnv?: FeatureFlagEnv
  defaultValues?: Partial<Record<FeatureFlagKey, boolean>>
  timeoutSeconds?: number
  options?: LDOptions
  initClient?: (sdkKey: string, options?: LDOptions) => LaunchDarklyClientLike
  logger?: Pick<Console, "warn">
}

export type FeatureFlagClient = {
  booleanVariation(
    flag: FeatureFlagDefinition,
    context: FeatureFlagContext,
  ): Promise<boolean>
}

const DEFAULT_TIMEOUT_SECONDS = 0.25

const clientCache = new Map<string, LaunchDarklyClientLike>()
const readyPromises = new Map<string, Promise<void>>()

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
    .then(() => undefined)
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
      if (value !== undefined) {
        ldContext[key] = value
      }
    }
  }

  return ldContext
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
  const localEnv = options.localEnv ?? {}
  const logger = options.logger

  return {
    async booleanVariation(flag, context) {
      const fallback = resolveLocalBooleanFallback(
        flag,
        localEnv,
        options.defaultValues,
      )

      if (!sdkKey) return fallback

      const client = getClient(sdkKey, options)

      try {
        await waitUntilReady(sdkKey, client, timeoutSeconds)
      } catch (error) {
        warn(
          logger,
          `[feature-flags] LaunchDarkly initialization failed for ${flag.key}; using fallback.`,
          error,
        )
        return fallback
      }

      try {
        const variation = await client.variation(
          flag.key,
          toLaunchDarklyContext(context),
          fallback,
        )
        return typeof variation === "boolean" ? variation : fallback
      } catch (error) {
        warn(
          logger,
          `[feature-flags] LaunchDarkly variation failed for ${flag.key}; using fallback.`,
          error,
        )
        return fallback
      }
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

export function resetFeatureFlagClientCacheForTests(): void {
  clientCache.clear()
  readyPromises.clear()
}
