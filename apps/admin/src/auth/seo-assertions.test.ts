import { createHash } from "node:crypto"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { exportSPKI, generateKeyPair, SignJWT } from "jose"

const mockEnv = vi.hoisted(() => ({
  env: {
    SEO_ASSERTION_ENVIRONMENT: "test",
    SEO_APPROVAL_PUBLIC_KEYS: "",
    SEO_WORKLOAD_PUBLIC_KEYS: "",
  },
}))

vi.mock("@/config/env", () => mockEnv)

import { verifySeoApprovalAssertion } from "./seo-approval-assertion"
import { SeoAssertionInvalidError } from "./seo-assertion-keyring"
import {
  seoRequestDigest,
  verifySeoWorkloadAssertion,
} from "./seo-service-assertion"

let approvalPrivateKey: CryptoKey
let workloadPrivateKey: CryptoKey
let approvalKeyring: string
let workloadKeyring: string

beforeAll(async () => {
  const approvalPair = await generateKeyPair("EdDSA", { extractable: true })
  const workloadPair = await generateKeyPair("EdDSA", { extractable: true })
  approvalPrivateKey = approvalPair.privateKey
  workloadPrivateKey = workloadPair.privateKey
  approvalKeyring = JSON.stringify({
    "approval-key": await exportSPKI(approvalPair.publicKey),
  })
  workloadKeyring = JSON.stringify({
    "workload-key": await exportSPKI(workloadPair.publicKey),
  })
  mockEnv.env.SEO_APPROVAL_PUBLIC_KEYS = approvalKeyring
  mockEnv.env.SEO_WORKLOAD_PUBLIC_KEYS = workloadKeyring
})

function nowSeconds() {
  return Math.floor(Date.now() / 1000)
}

async function workloadAssertion({
  body,
  capability = "ingest",
  lifetimeSeconds = 60,
}: {
  body: string
  capability?: "ingest" | "evaluate" | "tickets" | "watch_alerts"
  lifetimeSeconds?: number
}) {
  const now = nowSeconds()
  return new SignJWT({
    environment: "test",
    capability,
    requestDigest: seoRequestDigest(body),
    jti: `workload-jti-${capability}-123456789`,
  })
    .setProtectedHeader({
      alg: "EdDSA",
      kid: "workload-key",
      typ: "seo-workload+jwt",
    })
    .setIssuer("forge-mastra")
    .setAudience(`forge-admin:seo:${capability}`)
    .setIssuedAt(now)
    .setExpirationTime(now + lifetimeSeconds)
    .sign(workloadPrivateKey)
}

async function approvalAssertion(environment = "test", lifetimeSeconds = 60) {
  const now = nowSeconds()
  return new SignJWT({
    v: 1,
    env: environment,
    actorId: "manager-user-1",
    action: "approve",
    proposalId: "proposal-1",
    version: 1,
    payloadDigest: "a".repeat(64),
    nonce: "approval-nonce-123456789",
  })
    .setProtectedHeader({
      alg: "EdDSA",
      kid: "approval-key",
      typ: "seo-approval+jwt",
    })
    .setIssuer("forge-manager")
    .setAudience("forge-admin-seo-approval")
    .setIssuedAt(now)
    .setExpirationTime(now + lifetimeSeconds)
    .sign(approvalPrivateKey)
}

describe("SEO delegated assertions", () => {
  it("binds a workload assertion to its endpoint and exact raw body", async () => {
    const body =
      '{"action":"start_run","idempotencyKey":"daily-1","mode":"DRY_RUN"}'
    const assertion = await workloadAssertion({ body })

    await expect(
      verifySeoWorkloadAssertion({
        assertion,
        capability: "ingest",
        rawBody: body,
      }),
    ).resolves.toMatchObject({
      keyId: "workload-key",
      environment: "test",
      audience: "forge-admin:seo:ingest",
      capability: "ingest",
      requestDigest: createHash("sha256").update(body).digest("hex"),
    })
    await expect(
      verifySeoWorkloadAssertion({
        assertion,
        capability: "ingest",
        rawBody: `${body} `,
      }),
    ).rejects.toBeInstanceOf(SeoAssertionInvalidError)
    await expect(
      verifySeoWorkloadAssertion({
        assertion,
        capability: "tickets",
        rawBody: body,
      }),
    ).rejects.toBeInstanceOf(SeoAssertionInvalidError)
  })

  it("verifies an approval assertion and returns only a nonce hash", async () => {
    const assertion = await approvalAssertion()

    const verified = await verifySeoApprovalAssertion(assertion)

    expect(verified).toMatchObject({
      keyId: "approval-key",
      environment: "test",
      actorId: "manager-user-1",
      action: "approve",
      proposalId: "proposal-1",
      version: 1,
      payloadDigest: "a".repeat(64),
    })
    expect(verified.nonceHash).toBe(
      createHash("sha256").update("approval-nonce-123456789").digest("hex"),
    )
    expect(JSON.stringify(verified)).not.toContain("approval-nonce-123456789")
  })

  it("accepts the dedicated Watch alert workload capability", async () => {
    const body = '{"action":"claim_run"}'
    await expect(
      verifySeoWorkloadAssertion({
        assertion: await workloadAssertion({
          body,
          capability: "watch_alerts",
        }),
        capability: "watch_alerts",
        rawBody: body,
      }),
    ).resolves.toMatchObject({
      capability: "watch_alerts",
      audience: "forge-admin:seo:watch_alerts",
    })
  })

  it("fails closed when an approval assertion names another environment", async () => {
    await expect(
      verifySeoApprovalAssertion(await approvalAssertion("production")),
    ).rejects.toBeInstanceOf(SeoAssertionInvalidError)
  })

  it("rejects assertions whose signed lifetime exceeds the server maximum", async () => {
    const body = '{"action":"start_run"}'
    await expect(
      verifySeoWorkloadAssertion({
        assertion: await workloadAssertion({ body, lifetimeSeconds: 600 }),
        capability: "ingest",
        rawBody: body,
      }),
    ).rejects.toBeInstanceOf(SeoAssertionInvalidError)
    await expect(
      verifySeoApprovalAssertion(await approvalAssertion("test", 600)),
    ).rejects.toBeInstanceOf(SeoAssertionInvalidError)
  })

  it("fails closed when approval and workload verification keys overlap", async () => {
    mockEnv.env.SEO_WORKLOAD_PUBLIC_KEYS = approvalKeyring
    await expect(
      verifySeoApprovalAssertion(await approvalAssertion()),
    ).rejects.toThrow("SEO assertion verification is not configured")
    mockEnv.env.SEO_WORKLOAD_PUBLIC_KEYS = workloadKeyring
  })
})
