import { randomUUID } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { studioDocumentSchema } from "@forge/studio-contracts"
import { contentPackDocumentSchema } from "@forge/studio-contracts/content-packs"
import { calendarProductionSchema } from "@forge/studio-contracts/calendar"
import { studioGenerationBatchSchema } from "@forge/studio-contracts/generation"
import { calendarCommand, lockCalendarSlot } from "./calendar"
import { lockProject, assertEditable } from "./state"
import { resolveStudioDocumentSources } from "./sources"
import { resolveStudioPackSources } from "./packs"
import { readVerifiedStudioAsset } from "./assets"
import { StudioCommandError } from "./errors"

/** Explicit human selection only. Return the reviewed458 batch contract; never
 * generate, narrate or modify a project while admitting a calendar action. */
export async function admitCalendarProduction(
  db: PrismaClient,
  user: Principal | null,
  raw: unknown,
) {
  const input = calendarProductionSchema.parse(raw)
  return calendarCommand(db, user, "production", input, async (tx) => {
    const projects = new Map<string, Awaited<ReturnType<typeof lockProject>>>()
    for (const id of input.targets.map((target) => target.projectId).sort())
      projects.set(id, await lockProject(tx, id))
    const requests = []
    for (const target of [...input.targets].sort((a, b) =>
      a.date.localeCompare(b.date),
    )) {
      const slot = await lockCalendarSlot(tx, input.calendarId, target.date),
        project = projects.get(target.projectId)!
      if (
        slot.version !== target.version ||
        slot.projectId !== target.projectId
      )
        throw new StudioCommandError("STALE_BINDING")
      assertEditable(project, target.revision)
      const revision = await tx.shortRevision.findUniqueOrThrow({
        where: {
          projectId_number: { projectId: project.id, number: target.revision },
        },
      })
      const document = studioDocumentSchema.parse(revision.document)
      if (
        slot.packRevisionId &&
        !document.packRevisionIds.includes(slot.packRevisionId)
      )
        throw new StudioCommandError("UNREADY")
      const sources = await resolveStudioDocumentSources(tx, document)
      await resolveStudioPackSources(tx, document.packRevisionIds)
      let packSources = 0
      for (const id of document.packRevisionIds) {
        const row = await tx.contentPackRevision.findUniqueOrThrow({
          where: { id },
        })
        const pack = contentPackDocumentSchema.parse(row.document)
        for (const source of pack.sources) {
          await readVerifiedStudioAsset(tx, source.asset, 32 * 1024 * 1024)
          packSources++
        }
      }
      if (!sources.length && !packSources)
        throw new StudioCommandError("UNREADY")
      requests.push({
        projectId: project.id,
        expectedRevision: target.revision,
        idempotencyKey: randomUUID(),
        message: `Create reviewable script/composition proposals for the explicitly selected project using only its selected sources and Content Packs. Preserve edited work. Do not choose alternate sources, narrate, render or publish. Calendar title: ${slot.title}. Calendar theme: ${slot.theme}.`,
      })
    }
    return studioGenerationBatchSchema.parse({ requests, confirmed: true })
  })
}
