import { env } from "../../config/env"
import { afterAll, beforeAll, expect, test } from "vitest"
import { PostgresStore } from "@mastra/pg"
import { StudioInstructions } from "./instructions"
// Dedicated database is explicit, never inherited from DATABASE_URL.
const store = new PostgresStore({
  id: "studio457-test",
  connectionString:
    env.STUDIO_TEST_DATABASE_URL ??
    "postgresql://tataihono@127.0.0.1:55458/forge_studio_458_test",
  schemaName: "studio457_native",
})
const instructions = new StudioInstructions(store)
beforeAll(async () => {
  if (env.STUDIO_TEST_DATABASE_URL) {
    if (
      ![
        "postgresql://tataihono@127.0.0.1:55457/forge_studio_457_test",
        "postgresql://tataihono@127.0.0.1:55458/forge_studio_458_test",
      ].includes(env.STUDIO_TEST_DATABASE_URL)
    )
      throw new Error("Dedicated Studio457 database only")
    await store.init()
  }
})
afterAll(async () => {
  await store.close()
})
test.skipIf(!env.STUDIO_TEST_DATABASE_URL)(
  "draft save and restoration preserve active instructions; frozen admission survives activation",
  async () => {
    const initial = await instructions.inspect()
    const first = await instructions.save(
      initial.latest.id,
      "First {{language}}",
      "operator",
    )
    await instructions.activate(
      first.latest.id,
      initial.activeVersionId,
      "operator",
    )
    const frozen = await instructions.freeze(
      { mode: "active" },
      { language: "English" },
    )
    expect(frozen.effective).toContain("First English")
    const second = await instructions.save(
      first.latest.id,
      "Second {{language}}",
      "operator",
    )
    expect(second.activeVersionId).toBe(first.latest.id)
    expect(
      (await instructions.freeze({ mode: "active" }, { language: "English" }))
        .effective,
    ).toContain("First English")
    await instructions.activate(second.latest.id, first.latest.id, "operator")
    expect(
      (await instructions.freeze({ mode: "active" }, { language: "English" }))
        .effective,
    ).toContain("Second English")
    expect(frozen.effective).toContain("First English")
    const restored = await instructions.restore(
      first.latest.id,
      second.latest.id,
      "operator",
    )
    expect(restored.activeVersionId).toBe(second.latest.id)
    expect(restored.latest.content).toBe("First {{language}}")
    await expect(
      instructions.save(first.latest.id, "Lost update", "operator"),
    ).rejects.toThrow("CONFLICT")
  },
)
