import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

const emptyToUndefined = (value: string | undefined) =>
  value === "" ? undefined : value

export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    DATABASE_URL: z.string().url().optional(),
    AUTH_ISSUER_URL: z.string().url().optional(),
    AUTH_MASTRA_STUDIO_CLIENT_ID: z.string().min(1).optional(),
    AUTH_MASTRA_STUDIO_CLIENT_SECRET: z.string().min(1).optional(),
    MASTRA_GATEWAY_BASE_URL: z.string().url().optional(),
    MASTRA_GATEWAY_SESSION_SECRET: z.string().min(32).optional(),
    MASTRA_INTERNAL_BASE_URL: z.string().url().optional(),
    MASTRA_INTERNAL_API_KEY: z.string().min(1).optional(),
    MASTRA_DEVOTIONAL_APPROVAL_API_KEY: z.string().min(1).optional(),
    MASTRA_DEVOTIONAL_PLAYBACK_API_KEY: z.string().min(1).optional(),
    MASTRA_GATEWAY_ADMIN_API_KEYS: z.string().min(1).optional(),
    MASTRA_GATEWAY_BOOTSTRAP_ADMIN_EMAILS: z.string().optional(),
  },
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: emptyToUndefined(process.env.DATABASE_URL),
    AUTH_ISSUER_URL: emptyToUndefined(process.env.AUTH_ISSUER_URL),
    AUTH_MASTRA_STUDIO_CLIENT_ID: emptyToUndefined(
      process.env.AUTH_MASTRA_STUDIO_CLIENT_ID,
    ),
    AUTH_MASTRA_STUDIO_CLIENT_SECRET: emptyToUndefined(
      process.env.AUTH_MASTRA_STUDIO_CLIENT_SECRET,
    ),
    MASTRA_GATEWAY_BASE_URL: emptyToUndefined(
      process.env.MASTRA_GATEWAY_BASE_URL,
    ),
    MASTRA_GATEWAY_SESSION_SECRET: emptyToUndefined(
      process.env.MASTRA_GATEWAY_SESSION_SECRET,
    ),
    MASTRA_INTERNAL_BASE_URL: emptyToUndefined(
      process.env.MASTRA_INTERNAL_BASE_URL,
    ),
    MASTRA_INTERNAL_API_KEY: emptyToUndefined(
      process.env.MASTRA_INTERNAL_API_KEY,
    ),
    MASTRA_DEVOTIONAL_APPROVAL_API_KEY: emptyToUndefined(
      process.env.MASTRA_DEVOTIONAL_APPROVAL_API_KEY,
    ),
    MASTRA_DEVOTIONAL_PLAYBACK_API_KEY: emptyToUndefined(
      process.env.MASTRA_DEVOTIONAL_PLAYBACK_API_KEY,
    ),
    MASTRA_GATEWAY_ADMIN_API_KEYS: emptyToUndefined(
      process.env.MASTRA_GATEWAY_ADMIN_API_KEYS,
    ),
    MASTRA_GATEWAY_BOOTSTRAP_ADMIN_EMAILS:
      process.env.MASTRA_GATEWAY_BOOTSTRAP_ADMIN_EMAILS,
  },
  skipValidation: !!process.env.CI,
})

export function getGatewayBaseUrl() {
  return env.MASTRA_GATEWAY_BASE_URL ?? "http://localhost:3005"
}

export function getAuthIssuerUrl() {
  if (!env.AUTH_ISSUER_URL) {
    throw new Error("AUTH_ISSUER_URL is required for Mastra Studio OAuth")
  }
  return env.AUTH_ISSUER_URL.replace(/\/$/, "")
}

export function assertGatewayRuntimeEnv() {
  assertGatewayDevotionalKeysDisjoint()
  const isNextBuild = process.env.NEXT_PHASE === "phase-production-build"
  if (env.NODE_ENV !== "production" || isNextBuild) return

  const missing = [
    ["DATABASE_URL", env.DATABASE_URL],
    ["AUTH_ISSUER_URL", env.AUTH_ISSUER_URL],
    ["AUTH_MASTRA_STUDIO_CLIENT_ID", env.AUTH_MASTRA_STUDIO_CLIENT_ID],
    ["MASTRA_GATEWAY_SESSION_SECRET", env.MASTRA_GATEWAY_SESSION_SECRET],
    ["MASTRA_INTERNAL_BASE_URL", env.MASTRA_INTERNAL_BASE_URL],
    ["MASTRA_INTERNAL_API_KEY", env.MASTRA_INTERNAL_API_KEY],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name)

  if (missing.length > 0) {
    throw new Error(
      `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required for Mastra gateway production`,
    )
  }
}

export function assertGatewayDevotionalKeysDisjoint(
  serviceKey = env.MASTRA_INTERNAL_API_KEY,
  approvalKey = env.MASTRA_DEVOTIONAL_APPROVAL_API_KEY,
  playbackKey = env.MASTRA_DEVOTIONAL_PLAYBACK_API_KEY,
) {
  const configured = [serviceKey, approvalKey, playbackKey].filter(
    (value): value is string => Boolean(value),
  )
  if (new Set(configured).size !== configured.length) {
    throw new Error(
      "MASTRA_INTERNAL_API_KEY, MASTRA_DEVOTIONAL_APPROVAL_API_KEY, and MASTRA_DEVOTIONAL_PLAYBACK_API_KEY must be disjoint",
    )
  }
}

export function getBootstrapAdminEmails() {
  return (env.MASTRA_GATEWAY_BOOTSTRAP_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}
