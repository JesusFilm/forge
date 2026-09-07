import { afterAll, beforeAll, expect, test } from "vitest"
import { PostgresStore } from "@mastra/pg"
import { createCalendarInstructions } from "./calendar-planner"
const url = process.env.STUDIO_CALENDAR_TEST_DATABASE_URL
const store = new PostgresStore({
  id: "calendar461-native",
  connectionString: url ?? "postgresql://unused@127.0.0.1:1/unused",
  schemaName: "mastra_studio_authoring",
})
beforeAll(async () => {
  if (url) {
    if (url !== "postgresql://tataihono@127.0.0.1:55461/forge_studio_461_test")
      throw new Error("Task-owned database required")
    await store.init()
  }
})
afterAll(async () => store.close())
test.skipIf(!url)(
  "planner instructions use isolated native versions and freeze exact active bytes across drafts and restart",
  async () => {
    const instructions = createCalendarInstructions(store)
    const initial = await instructions.inspect()
    expect(initial.latest.agentId).toBe("studio-calendar-planner")
    expect(initial.latest.content).toContain("titles and themes only")
    await instructions.activate(
      initial.latest.id,
      initial.activeVersionId,
      "operator",
    )
    const frozen = await instructions.freeze(
      { mode: "active" },
      { language: "english" },
    )
    const draft = await instructions.save(
      initial.latest.id,
      "Calendar titles in {{language}} only.",
      "operator",
    )
    expect(
      (await instructions.freeze({ mode: "active" }, { language: "english" }))
        .digest,
    ).toBe(frozen.digest)
    const restarted = new PostgresStore({
      id: "calendar461-restarted",
      connectionString: url!,
      schemaName: "mastra_studio_authoring",
    })
    try {
      await restarted.init()
      expect(
        await createCalendarInstructions(restarted).freeze(
          { mode: "active" },
          { language: "english" },
        ),
      ).toEqual(frozen)
    } finally {
      await restarted.close()
    }
    // Leave defaults as a new inactive draft, retaining every prior native version.
    await instructions.restore(initial.latest.id, draft.latest.id, "operator")
    const agents = await store.getStore("agents")
    expect(
      (await agents!.getById("studio-calendar-planner"))?.activeVersionId,
    ).toBe(initial.latest.id)
  },
)
