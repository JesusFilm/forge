import { describe, expect, it } from "vitest"
import type { PrismaClient } from "@prisma/client"
import { MANAGER_BACKEND_PRINCIPAL } from "@/auth/principal"
import { ManagerAutomationService } from "./manager-automation.service"

const draft = {
  name: "Missing source subtitles",
  template: "source_subtitles_missing",
  runMode: "dry_run",
  refreshMode: "missing_only",
  schedule: {
    kind: "weekly",
    weekday: "mon",
    hour: 9,
    minute: 0,
    timezone: "UTC",
  },
  targetLanguageIds: [],
  maxVideosPerRun: 6,
}

describe("Manager automation admission", () => {
  const service = new ManagerAutomationService({} as PrismaClient)
  it("denies unauthenticated definition writes before touching persistence", async () => {
    await expect(service.create(null, draft)).rejects.toThrow("Forbidden")
  })
  it("rejects multiple target subtitle languages at the storage boundary", async () => {
    await expect(
      service.create(MANAGER_BACKEND_PRINCIPAL, {
        ...draft,
        template: "target_subtitles_missing",
        targetLanguageIds: ["529", "21028"],
      }),
    ).rejects.toThrow("exactly one target language")
  })
  it("rejects unsupported embedding automation templates", async () => {
    await expect(
      service.create(MANAGER_BACKEND_PRINCIPAL, {
        ...draft,
        template: "transcript_embeddings_missing",
      }),
    ).rejects.toThrow()
  })
  it("rejects invalid schedule timezones", async () => {
    await expect(
      service.create(MANAGER_BACKEND_PRINCIPAL, {
        ...draft,
        schedule: { ...draft.schedule, timezone: "Not/A_Zone" },
      }),
    ).rejects.toThrow("Invalid schedule timezone")
  })
})
