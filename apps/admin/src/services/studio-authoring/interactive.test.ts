import { describe, expect, it } from "vitest"
import { PrismaClient } from "@prisma/client"
import { StudioAuthoringService } from "./index"
import { publishStudioProject } from "./publication"
import { StudioExperimentService } from "./experiments"
import { studioActor } from "./state"
import { ForbiddenError } from "../errors"

const db = new PrismaClient()
describe("Studio interactive command authority", () => {
  it("denies review to a human-owned delegated principal before admitting input", async () => {
    const commands = new StudioAuthoringService(db)
    await expect(
      commands.approve({ id: "operator", role: "ADMIN" }, {}),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

it("keeps delegated attribution but refuses every explicit human review seam", async () => {
  const delegated = {
    id: "operator",
    role: "ADMIN" as const,
    studioAuthority: "delegated" as const,
  }
  expect(studioActor(delegated)).toEqual({
    id: "operator",
    kind: "human",
    authority: "delegated",
  })
  await expect(
    new StudioAuthoringService(db).unpublish(delegated, {}),
  ).rejects.toBeInstanceOf(ForbiddenError)
  await expect(
    new StudioExperimentService(db).request(delegated, { confirmed: true }),
  ).rejects.toBeInstanceOf(ForbiddenError)
  await expect(
    publishStudioProject(db, delegated, {}, async () => {}),
  ).rejects.toBeInstanceOf(ForbiddenError)
})
