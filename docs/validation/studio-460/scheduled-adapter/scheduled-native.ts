import { PrismaClient } from "/home/tataihono/.codex/worktrees/06c1/forge/apps/admin/node_modules/@prisma/client/index.js"
import {
  prepareScheduledStudioPublication,
  publishPreparedStudioProject,
} from "/home/tataihono/.codex/worktrees/06c1/forge/apps/admin/src/services/studio-authoring/scheduled-publication-adapter"
import {
  readFileSync,
  writeFileSync,
  openSync,
  fsyncSync,
  closeSync,
} from "node:fs"
import { randomUUID } from "node:crypto"
import assert from "node:assert/strict"
async function main() {
  const dir = "/home/tataihono/.cache/forge-studio-460-runtime/browser"
  const db = new PrismaClient()
  try {
    const actor = { id: null, role: "SYSTEM" as const }
    let envelope
    if (process.argv[2] === "retry") {
      envelope = JSON.parse(
        readFileSync(dir + "/scheduled-envelope.json", "utf8"),
      )
    } else {
      const f = JSON.parse(readFileSync(dir + "/fixture.json", "utf8"))
      const project = await db.studioProject.findUniqueOrThrow({
        where: { id: f.projectId },
      })
      const release = await db.studioCatalogRelease.findFirstOrThrow({
        where: { projectId: project.id, revision: project.currentRevision },
      })
      const approval = await db.studioApproval.findFirstOrThrow({
        where: {
          projectId: project.id,
          revision: project.currentRevision,
          kind: "PUBLICATION",
          renderAttemptId: release.renderAttemptId,
        },
      })
      const request = {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        approvalId: approval.id,
        renderAttemptId: release.renderAttemptId,
        releaseId: release.id,
        idempotencyKey: randomUUID(),
        schedule: {
          scheduleId: randomUUID(),
          version: 1,
          dueAt: new Date(Date.now() - 1000).toISOString(),
          latestAllowedAt: new Date(Date.now() + 120000).toISOString(),
        },
      }
      envelope = await prepareScheduledStudioPublication(request)
      const { readinessId, ...returned } = envelope
      assert.deepEqual(returned, request)
      assert.ok(readinessId)
      // Owned durable envelope fixture, not Calendar461's production storage.
      writeFileSync(dir + "/scheduled-envelope.json", JSON.stringify(envelope))
      const fd = openSync(dir + "/scheduled-envelope.json", "r")
      fsyncSync(fd)
      closeSync(fd)
    }
    const marker = "schedule-native:" + envelope.schedule.scheduleId
    let calls = 0
    const receipt = await publishPreparedStudioProject(
      db,
      actor,
      envelope,
      async (tx, binding) => {
        calls++
        assert.deepEqual(binding, envelope)
        assert.ok(
          Date.now() >= Date.parse(binding.schedule.dueAt) &&
            Date.now() <= Date.parse(binding.schedule.latestAllowedAt),
        )
        await tx.studioCommand.create({
          data: {
            projectId: envelope.projectId,
            idempotencyKey: marker,
            inputHash: "local-calendar-contract-fixture",
            actor: { kind: "service", id: "local-calendar-fixture" },
            result: {
              projectId: envelope.projectId,
              revision: envelope.expectedRevision,
              outcome: "ACCEPTED",
            },
          },
        })
      },
    )
    assert.equal(
      await db.studioCommand.count({
        where: { projectId: envelope.projectId, idempotencyKey: marker },
      }),
      1,
    )
    assert.equal(calls, process.argv[2] === "retry" ? 0 : 1)
    const project = await db.studioProject.findUniqueOrThrow({
      where: { id: envelope.projectId },
    })
    if (process.argv[2] === "retry")
      assert.equal(project.lifecycle, "UNPUBLISHED")
    console.log(
      JSON.stringify({
        mode: process.argv[2],
        receipt,
        consumeCalls: calls,
        lifecycle: project.lifecycle,
        scope:
          "Actual Admin→Manager HTTP preparation; local signed provider; explicit calendar hook/storage fixture, not461 acceptance",
      }),
    )
  } finally {
    await db.$disconnect()
  }
}
void main()
