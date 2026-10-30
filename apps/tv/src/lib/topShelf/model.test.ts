import {
  concepts,
  selectConcept,
  parseRotation,
  snapshotSchema,
  type Concept,
} from "./model"

it("visits all eligible concepts without an adjacent repeat across bag boundaries", () => {
  let state = null as ReturnType<typeof selectConcept>
  const selected: Concept[] = []
  for (let day = 0; day < 10; day++) {
    state = selectConcept(concepts, state, String(day), () => 0.5)
    selected.push(state!.concept)
  }
  expect(new Set(selected.slice(0, 5)).size).toBe(5)
  expect(new Set(selected.slice(5)).size).toBe(5)
  for (let i = 1; i < selected.length; i++)
    expect(selected[i]).not.toBe(selected[i - 1])
})
it("keeps a persisted selection stable on repeated same-day OS preparations", () => {
  const state = selectConcept(concepts, null, "today", () => 0)!
  expect(
    selectConcept(
      concepts,
      parseRotation(JSON.stringify(state)),
      "today",
      () => 1,
    ),
  ).toEqual(state)
})
it("removes unavailable resume and handles one or zero eligible modes", () => {
  const old = {
    day: "today",
    concept: "continue" as const,
    remaining: ["short" as const],
  }
  expect(selectConcept(["short"], old, "today")?.concept).toBe("short")
  expect(selectConcept(["short"], old, "tomorrow")?.concept).toBe("short")
  expect(selectConcept([], old, "today")).toBeNull()
})
it("rejects credentials and malicious destinations in shared snapshots", () => {
  const base = {
    schemaVersion: 1,
    concept: "spotlight",
    language: "english",
    generatedAt: new Date().toISOString(),
    expiresAt: new Date().toISOString(),
    items: [
      {
        id: "a",
        slug: "jesus",
        title: "JESUS",
        summary: "",
        duration: 10,
        kind: "video",
        imageURL: "https://image.mux.com/a.jpg",
      },
    ],
  }
  expect(snapshotSchema.safeParse(base).success).toBe(true)
  expect(
    snapshotSchema.safeParse({ ...base, viewerToken: "secret" }).success,
  ).toBe(false)
  expect(
    snapshotSchema.safeParse({
      ...base,
      items: [{ ...base.items[0], slug: "../profile" }],
    }).success,
  ).toBe(false)
  expect(
    snapshotSchema.safeParse({
      ...base,
      items: [
        {
          ...base.items[0],
          imageURL: "https://user:pass@example.com/image.jpg",
        },
      ],
    }).success,
  ).toBe(false)
})
