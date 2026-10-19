import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { createLocalCodexAccountReader } from "./codex-local-account"
import { createCodexSubscriptionAstraModel } from "./codex-subscription-astra"
import { manualGenerationInputDigest } from "./manual-subscription-catalog"
import { planContentProfile } from "./content-profile-plan"
import {
  subscriptionModelIdSchema,
  type SubscriptionModelId,
} from "./subscription-model"
import { videoSchema } from "./source-generation"
import { parseManualCatalogCommand } from "../../scripts/run-manual-subscription-catalog"

const scratch: string[] = []
beforeEach(() => vi.stubEnv("CI", ""))
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(
    scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})
async function fakeCli(known = true) {
  const dir = await mkdtemp(join(tmpdir(), "forge-sol-model-test-"))
  scratch.push(dir)
  const executable = join(dir, "codex.cjs")
  const capture = join(dir, "capture.json")
  const events = [
    { type: "thread.started", thread_id: "fake-thread" },
    { type: "turn.started" },
    {
      type: "item.completed",
      item: { type: "agent_message", text: '{"ok":true}' },
    },
    ...(known
      ? [
          {
            type: "turn.completed",
            usage: {
              input_tokens: 17,
              output_tokens: 5,
              cached_input_tokens: 2,
            },
          },
        ]
      : []),
  ]
  await writeFile(
    executable,
    `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({args:process.argv.slice(2),prompt:fs.readFileSync(0,"utf8"),env:process.env}));
for (const e of ${JSON.stringify(events)}) console.log(JSON.stringify(e));
process.exit(${known ? 0 : 1});
`,
    { mode: 0o700 },
  )
  return { executable, capture }
}
function adapter(
  executable: string,
  modelId?: SubscriptionModelId,
  remaining = 70,
) {
  return createCodexSubscriptionAstraModel({
    modelId,
    codexExecutable: executable,
    initiatingAccountRef: "test-operator-123",
    readOperatorIdentity: async () => ({
      observedAt: new Date().toISOString(),
      accountRef: "test-operator-123",
      authMethod: "chatgpt",
    }),
    readAllowance: async () => ({
      observedAt: new Date().toISOString(),
      accountRef: "test-operator-123",
      billingBasis: "included_subscription",
      weeklyRemainingPercent: remaining,
      fiveHour: { kind: "not_applicable", plan: "pro" },
    }),
  })
}
const request = {
  schema: z.object({ ok: z.literal(true) }),
  system: "Trusted task",
  prompt: "untrusted catalog",
  maxOutputTokens: 32,
}

describe("legacy subscription Sol selection", () => {
  it.each([undefined, "gpt-6-astra", "gpt-6.1-sol"] as const)(
    "dispatches exact %s identity without changing security or usage",
    async (selected) => {
      const cli = await fakeCli()
      const model = adapter(cli.executable, selected)
      const reserve = vi.fn(async () => ({
        kind: "dispatch" as const,
        reservation: "physical-origin",
      }))
      const result = await model.generateReserved(request, reserve)
      expect(reserve).toHaveBeenCalledTimes(1)
      expect(result).toMatchObject({
        kind: "dispatched",
        reservation: "physical-origin",
        response: {
          output: { ok: true },
          usage: { inputTokens: 17, outputTokens: 5, cachedInputTokens: 2 },
        },
      })
      const capture = JSON.parse(await readFile(cli.capture, "utf8"))
      expect(capture.args[capture.args.indexOf("--model") + 1]).toBe(
        selected ?? "gpt-6-astra",
      )
      expect(capture.args).toContain('forced_login_method="chatgpt"')
      expect(capture.args).toContain("features.shell_tool=false")
      expect(capture.env.OPENAI_API_KEY).toBeUndefined()
      expect(JSON.parse(capture.prompt)).toMatchObject({
        instructions: request.system,
        untrustedCatalogData: request.prompt,
      })
      expect(model.getOperatorProvenance()?.modelId).toBe(
        selected ?? "gpt-6-astra",
      )
    },
  )
  it("binds Sol attestation without changing account/allowance RPCs or probing a model", async () => {
    const dir = await mkdtemp(join(tmpdir(), "forge-sol-account-test-"))
    scratch.push(dir)
    const executable = join(dir, "account.cjs")
    const capture = join(dir, "methods.jsonl")
    const account = {
      account: { type: "chatgpt", email: null, planType: "pro" },
      requiresOpenaiAuth: true,
    }
    const limits = {
      accountId: "backend-test-account",
      rateLimitsByLimitId: {
        codex: {
          limitId: "codex",
          planType: "pro",
          spendControlReached: false,
          rateLimitReachedType: null,
          primary: {
            usedPercent: 20,
            windowDurationMins: 10080,
            resetsAt: Math.floor(Date.now() / 1000) + 3600,
          },
          secondary: null,
        },
      },
    }
    await writeFile(
      executable,
      `#!/usr/bin/env node
const fs = require("node:fs");
require("node:readline").createInterface({input:process.stdin}).on("line", line => {
 const r = JSON.parse(line); fs.appendFileSync(${JSON.stringify(capture)}, r.method+"\\n");
 if (!r.id) return;
 const result = r.id === 1 ? {} : r.id === 2 || r.id === 4 ? ${JSON.stringify(account)} : ${JSON.stringify(limits)};
 console.log(JSON.stringify({id:r.id,result}));
});
`,
      { mode: 0o700 },
    )
    const reader = createLocalCodexAccountReader({
      codexExecutable: executable,
      modelId: "gpt-6.1-sol",
    })
    expect(await reader.readAttestation()).toMatchObject({
      modelId: "gpt-6.1-sol",
      admission: "admitted",
      allowance: {
        billingBasis: "included_subscription",
        weeklyRemainingPercent: 80,
      },
    })
    expect((await readFile(capture, "utf8")).trim().split("\n")).toEqual([
      "initialize",
      "initialized",
      "account/read",
      "account/rateLimits/read",
      "account/read",
      "account/rateLimits/read",
    ])
  })
  it("retains the 25% floor before reservation for Sol", async () => {
    const cli = await fakeCli()
    const reserve = vi.fn()
    await expect(
      adapter(cli.executable, "gpt-6.1-sol", 25).generateReserved(
        request,
        reserve,
      ),
    ).rejects.toMatchObject({
      code: "allowance_insufficient",
      consumptionUnknown: false,
    })
    expect(reserve).not.toHaveBeenCalled()
    await expect(readFile(cli.capture)).rejects.toMatchObject({
      code: "ENOENT",
    })
  })
  it("does not retry or zero an unknown Sol physical call", async () => {
    const cli = await fakeCli(false)
    const model = adapter(cli.executable, "gpt-6.1-sol")
    const reserve = vi.fn(async () => ({
      kind: "dispatch" as const,
      reservation: "origin",
    }))
    await expect(
      model.generateReserved(request, reserve),
    ).rejects.toMatchObject({ consumptionUnknown: true })
    await expect(
      model.generateReserved(request, reserve),
    ).rejects.toMatchObject({ code: "adapter_paused" })
    expect(reserve).toHaveBeenCalledTimes(1)
  })
  it("keeps historical generation and profile keys while separating Sol", () => {
    const input = {
      inputCutoff: "2026-10-01T00:00:00.000Z",
      videos: [],
      selectedCorpusDigest: "a".repeat(64),
      candidatePoolDigest: "b".repeat(64),
    }
    expect(manualGenerationInputDigest(input)).toBe(
      manualGenerationInputDigest({ ...input, modelId: "gpt-6-astra" }),
    )
    expect(
      manualGenerationInputDigest({ ...input, modelId: "gpt-6.1-sol" }),
    ).not.toBe(manualGenerationInputDigest(input))
    const video = videoSchema.parse({
      id: "v",
      coreId: "v",
      slug: "v",
      locale: "en",
      title: "Video",
      description: "Metadata",
      descriptionTruncated: false,
      keywords: [],
      keywordsTruncated: false,
      bibleCitations: [],
      bibleCitationsTruncated: false,
      parentVideoIds: [],
      childVideoIds: [],
      transcriptLanguages: [],
      transcriptSelection: {
        policy: "english-per-edition-with-complete-fallback-v1",
        availableTranscriptCount: 0,
        incompleteTranscriptCount: 0,
        skippedEditionCount: 0,
        selected: [],
      },
    })
    const profile = {
      video,
      chunks: [],
      maxPartBytes: 24_576,
      backend: "codex_chatgpt_subscription",
      promptVersion: "complete-profile-v6",
      schemaVersion: "complete-profile-schema-v1",
    }
    const astra = planContentProfile({ ...profile, modelId: "gpt-6-astra" })
    const sol = planContentProfile({ ...profile, modelId: "gpt-6.1-sol" })
    expect(sol.metadataDigest).toBe(astra.metadataDigest)
    expect(sol.chunkDigest).toBe(astra.chunkDigest)
    expect(sol.cacheKey).not.toBe(astra.cacheKey)
  })
  it("accepts only the two explicit models", () => {
    expect(subscriptionModelIdSchema.safeParse("gpt-6.1-sol").success).toBe(
      true,
    )
    expect(subscriptionModelIdSchema.safeParse("gpt-6-astra").success).toBe(
      true,
    )
    expect(subscriptionModelIdSchema.safeParse("gpt-5.6-sol").success).toBe(
      false,
    )
  })
  it("binds the manual CLI model within input, rejecting aliases", () => {
    const digest = "a".repeat(64)
    const cutoff = "2026-10-01T00:00:00.000Z"
    const config = {
      input: {
        invocation: "start",
        modelId: "gpt-6.1-sol",
        generationId: "new-sol-generation",
        generationInputDigest: digest,
        attemptId: "11111111-1111-4111-8111-111111111111",
        inputCutoff: cutoff,
        initiatingAccountRef: "test-operator-123",
        reviewed: {
          sourceVideoIds: ["v"],
          sourceSetDigest: digest,
          selectedCorpusDigest: digest,
          candidatePoolDigest: digest,
        },
        destination: {
          generationId: "new-sol-generation",
          generationInputDigest: digest,
          inputCutoff: cutoff,
          sourceSetDigest: digest,
          selectedCorpusDigest: digest,
          candidatePoolDigest: digest,
          routeMappingDigest: digest,
          sourcePatternTableDigest: digest,
          querySpecDigest: digest,
          propertyId: "320198532",
          propertyTimeZone: "America/New_York",
          qualificationPolicy: "referrer_navigation_v1",
          requestedStart: "2022-08-08",
          requestedEnd: "2026-09-30",
          usableStart: "2022-08-08",
          usableEnd: "2026-09-30",
          requestedCoverageDigest: digest,
          usableCoverageDigest: digest,
        },
        originGenerationId: "legacy-ga-origin",
        work: { mode: "full" },
      },
      codexExecutable: "/usr/bin/codex",
      stagingDirectory: "/private/stage",
      capacityProbe: { executable: "/private/probe", args: [] },
    }
    const args = ["--config", "/private/config.json", "--execute"]
    expect(parseManualCatalogCommand(config, args).input.modelId).toBe(
      "gpt-6.1-sol",
    )
    expect(() =>
      parseManualCatalogCommand(
        { ...config, input: { ...config.input, modelId: "sol" } },
        args,
      ),
    ).toThrow()
  })
})
