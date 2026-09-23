/** Explicit isolated fixture interleaving/expiry. Not an authenticated browser action. */
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { randomUUID, createHash } from "node:crypto"
async function main() {
  const [output, mode, projectId, value] = process.argv.slice(2)
  Object.assign(
    process.env,
    JSON.parse(await readFile(join(output, "environment.json"), "utf8")),
  )
  if (
    process.env.DATABASE_URL !==
    "postgresql://tataihono@127.0.0.1:55460/forge_studio_548_qualification"
  )
    throw new Error("Isolated qualification database required")
  const { prisma: db } = await import("../src/db/client")
  const fixture = JSON.parse(
    await readFile(join(output, "fixtures.json"), "utf8"),
  )
  const { StudioAuthoringService } =
    await import("../src/services/studio-authoring")
  const commands = new StudioAuthoringService(db)
  const user = {
    id: fixture.userId,
    role: "EDITOR" as const,
    managerRole: "OPERATOR" as const,
    studioAuthority: "interactive" as const,
  }
  try {
    const project = await commands.read(user, projectId)
    if (mode === "human-title") {
      const result = await commands.apply(user, {
        projectId,
        expectedRevision: project.revision,
        idempotencyKey: randomUUID(),
        operations: [{ kind: "set-metadata", title: value }],
      })
      await writeFile(
        join(output, `human-interleaving-${result.revision}.json`),
        JSON.stringify({ fixtureOnly: true, mode, result, title: value }),
        { mode: 0o600 },
      )
      console.log(
        `Synthetic interactive edit accepted at revision ${result.revision}`,
      )
    } else if (mode === "expire-capability") {
      let capability = ""
      for await (const chunk of process.stdin) {
        capability += String(chunk)
        if (capability.length > 8192)
          throw new Error("Capability input exceeds bound")
      }
      const path = new URL(capability.trim()).pathname
      const token = /^\/api\/shorts\/assets\/transfer\/([a-f0-9]{64})$/.exec(
        path,
      )?.[1]
      if (!token) throw new Error("Exact capability path required")
      const row = await db.shortAssetTransfer.findUniqueOrThrow({
        where: { tokenHash: createHash("sha256").update(token).digest("hex") },
      })
      const principal = JSON.parse(JSON.stringify(row.principal))
      if (principal.id !== fixture.userId)
        throw new Error("Only this fixture actor's capability may expire")
      await db.shortAssetTransfer.update({
        where: { tokenHash: row.tokenHash },
        data: { expiresAt: new Date(0) },
      })
      console.log(
        "Isolated fixture capability expired; fresh grants remain available",
      )
    } else if (mode === "evidence") {
      const history = await commands.history(user, projectId, { limit: 20 })
      const admissions = await db.shortNarrationAdmission.findMany({
        where: { projectId },
      })
      await writeFile(
        join(output, "canonical-project-evidence.json"),
        JSON.stringify({ project, history, admissions }, null, 2),
        { mode: 0o600 },
      )
      console.log(`Recorded canonical fixture revision ${project.revision}`)
    } else throw new Error("Unknown fixture check")
  } finally {
    await db.$disconnect()
  }
}
void main()
