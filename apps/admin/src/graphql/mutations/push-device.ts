/** @classification public-shape */
/**
 * KTD7 — the two fleet write paths for push.
 *
 * Both are public-shaped and both enforce their own admission inside the
 * resolver body: the consumer bearer is required, the fleet principal is
 * accepted, and an optional viewer handle is verified when it is present.
 * Neither resolver ever logs a token, a handle, or a digest.
 */
import { GraphQLError } from "graphql"

import { builder } from "@/graphql/builder"
import { admitPushWrite } from "@/services/push/admission"
import { assertPushCeiling } from "@/services/push/ceiling"
import { readPushEdgeCountry } from "@/services/push/country"
import {
  PushAdmissionError,
  PushCeilingExceededError,
  PushServiceError,
} from "@/services/push/errors"
import {
  reportPushOpen,
  type PushOpenReceipt,
} from "@/services/push/open-report.service"
import {
  registerPushDevice,
  type PushDeviceRegistrationReceipt,
} from "@/services/push/registration.service"

const PushDevicePlatformEnum = builder.enumType("PushDevicePlatform", {
  values: { IOS: { value: "IOS" }, ANDROID: { value: "ANDROID" } } as const,
})

/** R1 and R29 — one grant covers announcements, and a revocation is reported. */
const PushPermissionStateEnum = builder.enumType("PushPermissionState", {
  values: {
    granted: { value: "granted" },
    denied: { value: "denied" },
  } as const,
})

/** `INVALID` is never returned: a retired token is refused, not reported. */
const PushRegistrationStateEnum = builder.enumType("PushRegistrationState", {
  values: {
    ACTIVE: { value: "ACTIVE" },
    INACTIVE: { value: "INACTIVE" },
    SUPERSEDED: { value: "SUPERSEDED" },
  } as const,
})

const PushOpenOutcomeEnum = builder.enumType("PushOpenOutcome", {
  values: {
    STORED: { value: "STORED" },
    DUPLICATE: { value: "DUPLICATE" },
    UNKNOWN: { value: "UNKNOWN" },
  } as const,
})

const RegisterPushDeviceInput = builder.inputType("RegisterPushDeviceInput", {
  fields: (t) => ({
    expoPushToken: t.string({ required: true }),
    platform: t.field({ type: PushDevicePlatformEnum, required: true }),
    appBuild: t.string({ required: true }),
    appLanguageSlug: t.string({ required: true }),
    phoneLocale: t.string({ required: true }),
    timeZone: t.string({ required: true }),
    permission: t.field({ type: PushPermissionStateEnum, required: true }),
    viewerToken: t.string({ required: false }),
    sessionToken: t.string({ required: false }),
  }),
})

const ReportPushOpenInput = builder.inputType("ReportPushOpenInput", {
  fields: (t) => ({
    nonce: t.string({ required: true }),
    viewerToken: t.string({ required: false }),
    sessionToken: t.string({ required: false }),
  }),
})

const PushDeviceRegistrationReceiptRef =
  builder.objectRef<PushDeviceRegistrationReceipt>(
    "PushDeviceRegistrationReceipt",
  )
PushDeviceRegistrationReceiptRef.implement({
  description:
    "What one registration answers. The test ID is the identifier the app shows on Profile; it is never the push token.",
  fields: (t) => ({
    testDeviceId: t.exposeString("testDeviceId", { nullable: false }),
    status: t.field({
      type: PushRegistrationStateEnum,
      nullable: false,
      resolve: (receipt) => receipt.status,
    }),
  }),
})

const PushOpenReceiptRef = builder.objectRef<PushOpenReceipt>("PushOpenReceipt")
PushOpenReceiptRef.implement({
  description:
    "What one open report answers. A duplicate and an unknown nonce are both normal outcomes, never errors.",
  fields: (t) => ({
    outcome: t.field({
      type: PushOpenOutcomeEnum,
      nullable: false,
      resolve: (receipt) => receipt.outcome,
    }),
  }),
})

/**
 * Typed push failures reach the app with a code it can branch on. Anything
 * else stays an internal error, which Yoga masks.
 */
function toPushGraphQLError(error: unknown): GraphQLError {
  if (error instanceof PushAdmissionError) {
    return new GraphQLError(error.message, {
      extensions: { code: "UNAUTHENTICATED", pushCode: error.code },
    })
  }
  if (error instanceof PushCeilingExceededError) {
    return new GraphQLError(error.message, {
      extensions: { code: "TOO_MANY_REQUESTS", pushCode: error.code },
    })
  }
  if (error instanceof PushServiceError) {
    return new GraphQLError(error.message, {
      extensions: { code: "BAD_USER_INPUT", pushCode: error.code },
    })
  }
  throw error
}

async function resolvePushOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw toPushGraphQLError(error)
  }
}

builder.mutationFields((t) => ({
  registerPushDevice: t.field({
    type: PushDeviceRegistrationReceiptRef,
    nullable: false,
    authScopes: { public: true },
    args: { input: t.arg({ type: RegisterPushDeviceInput, required: true }) },
    resolve: (_root, args, ctx) =>
      resolvePushOperation(async () => {
        const { viewerToken, sessionToken, ...input } = args.input
        const admission = await admitPushWrite(ctx.prisma, {
          caller: ctx.user,
          handle: { viewerToken, sessionToken },
        })
        await assertPushCeiling("register", admission.fleetKeyId)
        return registerPushDevice(ctx.prisma, {
          input,
          edgeCountry: readPushEdgeCountry(ctx.request.headers),
          viewerDigest: admission.viewerDigest,
        })
      }),
  }),

  reportPushOpen: t.field({
    type: PushOpenReceiptRef,
    nullable: false,
    authScopes: { public: true },
    args: { input: t.arg({ type: ReportPushOpenInput, required: true }) },
    resolve: (_root, args, ctx) =>
      resolvePushOperation(async () => {
        const { viewerToken, sessionToken, nonce } = args.input
        const admission = await admitPushWrite(ctx.prisma, {
          caller: ctx.user,
          handle: { viewerToken, sessionToken },
        })
        await assertPushCeiling("open", admission.fleetKeyId)
        return reportPushOpen(ctx.prisma, {
          input: { nonce },
          viewerDigest: admission.viewerDigest,
          sessionDigest: admission.sessionDigest,
        })
      }),
  }),
}))
