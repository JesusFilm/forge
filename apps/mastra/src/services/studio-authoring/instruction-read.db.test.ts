import { randomUUID } from "node:crypto"
import { generateKeyPair, exportPKCS8, exportSPKI } from "jose"
import { PostgresStore } from "@mastra/pg"
import { MockLanguageModelV3 } from "ai/test"
import { expect, it, vi } from "vitest"
import { signStudioRequest } from "@forge/studio-server"
import { env } from "../../config/env"
import { createStudioRuntime } from "./runtime"
import { studioRuntimeAvailable } from "./availability"
const url = env.STUDIO_TEST_DATABASE_URL
class StudioReadHarnessError extends Error {}
it.skipIf(!url)(
  "reads scoped native guidance without hosted execution and preserves signed scope checks",
  async () => {
    if (url !== "postgresql://tataihono@127.0.0.1:55460/forge_studio_460_fresh")
      throw new StudioReadHarnessError("Dedicated local database only")
    const pair = await generateKeyPair("EdDSA", { extractable: true })
    const privateKey = await exportPKCS8(pair.privateKey),
      publicKeys = JSON.stringify({ test: await exportSPKI(pair.publicKey) })
    const storage = new PostgresStore({
      id: "instruction-read",
      connectionString: url,
      schemaName: "studio607_read_" + randomUUID().replaceAll("-", ""),
    })
    const init = vi.spyOn(storage, "init"),
      claim = vi.fn(),
      finish = vi.fn()
    const runtime = createStudioRuntime(storage, {
      publicKeys,
      environment: "test",
      admissionSecret: "",
      model: new MockLanguageModelV3({}),
      claim,
      finish,
      serialize: (work) => work(),
    })
    const raw = { action: "instructions", command: { action: "inspect" } },
      body = JSON.stringify(raw)
    expect(studioRuntimeAvailable(raw, { enabled: false, publicKeys })).toBe(
      true,
    )
    expect(
      (
        await runtime(
          new Request("http://studio.test/forge-shorts", {
            method: "POST",
            body,
          }),
        )
      ).status,
    ).toBe(403)
    expect(init).not.toHaveBeenCalled()
    const call = async (scopes: string[]) => {
      const assertion = await signStudioRequest(
        body,
        "forge-mastra:shorts",
        { sub: "operator", authority: "delegated", clientId: "codex", scopes },
        { privateKey, keyId: "test", environment: "test" },
      )
      return runtime(
        new Request("http://studio.test/forge-shorts", {
          method: "POST",
          body,
          headers: { "x-forge-shorts-service": assertion },
        }),
      )
    }
    try {
      expect((await call(["shorts:read"])).status).toBe(403)
      const response = await call(["shorts:instructions:read"])
      expect(response.status).toBe(200)
      expect(await response.json()).toHaveProperty("result")
      expect(claim).not.toHaveBeenCalled()
      expect(finish).not.toHaveBeenCalled()
    } finally {
      await storage.close()
    }
  },
)
