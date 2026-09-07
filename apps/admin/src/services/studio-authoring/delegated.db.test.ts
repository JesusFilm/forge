import { STUDIO_RENDER_TEST_DATABASE_URL } from "./database.test-support"
import { randomUUID, createHash } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { expect, test } from "vitest"
import { z } from "zod"
import { env } from "@/config/env"
import { executeStudioDelegated } from "./delegated"
import { executeStudioInteractive } from "./interactive"
import { StudioTransferService } from "./transfers"
import { StudioAssetService } from "./assets"
import {
  studioDocumentSchema,
  studioProjectSchema,
} from "@forge/studio-contracts"
const url = env.STUDIO_TEST_DATABASE_URL
const run = url ? test : test.skip
run(
  "manual and delegated edits share revision checks; scoped uploads retain verified actor",
  async () => {
    if (
      url !== STUDIO_RENDER_TEST_DATABASE_URL &&
      ![
        "postgresql://tataihono@127.0.0.1:55457/forge_studio_457_test",
        "postgresql://tataihono@127.0.0.1:55458/forge_studio_458_test",
      ].includes(url!)
    )
      throw new Error("Dedicated457 database only")
    const db = new PrismaClient({ datasources: { db: { url } } })
    try {
      const id = randomUUID()
      await db.user.create({
        data: {
          id,
          name: "Studio test",
          email: `${id}@example.test`,
          role: "EDITOR",
          managerMembership: { create: { role: "OPERATOR" } },
        },
      })
      const human = {
          id,
          role: "EDITOR" as const,
          managerRole: "OPERATOR" as const,
          studioAuthority: "interactive" as const,
        },
        caller = {
          sub: id,
          authority: "delegated" as const,
          clientId: "claude",
          scopes: ["studio:read", "studio:edit", "studio:chat"],
        }
      const projectId = randomUUID(),
        document = studioDocumentSchema.parse({
          version: 1,
          title: "Before",
          language: "en",
          runtimeVersion: "studio-test",
          width: 1080,
          height: 1920,
          fps: 30,
          durationInFrames: 300,
          tracks: [],
          items: [],
          components: [],
          packRevisionIds: [],
        })
      await executeStudioInteractive(db, human, {
        action: "create",
        input: {
          projectId,
          expectedRevision: 0,
          idempotencyKey: randomUUID(),
          document,
        },
      })
      const command = {
        projectId,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
        operations: [{ kind: "set-metadata", title: "After" }],
      }
      await expect(
        executeStudioDelegated(
          db,
          { ...caller, scopes: ["studio:read"] },
          { action: "apply", input: command },
        ),
      ).rejects.toThrow("scope")
      await executeStudioDelegated(db, caller, {
        action: "apply",
        input: command,
      })
      const project = studioProjectSchema.parse(
        await executeStudioDelegated(db, caller, {
          action: "read",
          input: projectId,
        }),
      )
      expect(project.document.title).toBe("After")
      expect(project.actor).toMatchObject({
        id,
        authority: "delegated",
        clientId: "claude",
      })
      await expect(
        executeStudioInteractive(db, human, {
          action: "apply",
          input: { ...command, idempotencyKey: randomUUID() },
        }),
      ).rejects.toThrow("CONFLICT")
      await expect(
        executeStudioDelegated(db, caller, { action: "approve", input: {} }),
      ).rejects.toThrow()
      const admission = {
        projectId,
        expectedRevision: 2,
        idempotencyKey: randomUUID(),
        kind: "GENERATION",
        instructions: [],
        executionInputDigest: "a".repeat(64),
      }
      const admitted = await executeStudioDelegated(db, caller, {
        action: "request",
        input: admission,
      })
      expect(
        await executeStudioDelegated(db, caller, {
          action: "request",
          input: admission,
        }),
      ).toEqual(admitted)
      await expect(
        executeStudioDelegated(db, caller, {
          action: "request",
          input: { ...admission, executionInputDigest: "b".repeat(64) },
        }),
      ).rejects.toThrow("CONFLICT")
      for (const actor of [
        human,
        {
          ...human,
          studioAuthority: "delegated" as const,
          studioClientId: "claude",
        },
      ]) {
        const bytes = Buffer.from("export const Component = () => null"),
          transfer = new StudioTransferService(db)
        const payload = {
          metadata: {
            idempotencyKey: randomUUID(),
            filename: "component.tsx",
            mimeType: "text/plain",
            role: "component",
            provenance: { status: "recorded", recorded: {} },
          },
          byteSize: bytes.length,
          digest: createHash("sha256").update(bytes).digest("hex"),
        }
        await expect(
          executeStudioDelegated(
            db,
            { ...caller, scopes: ["studio:read"] },
            { action: "asset-upload", input: payload },
          ),
        ).rejects.toThrow("scope")
        await expect(
          executeStudioDelegated(db, caller, {
            action: "asset-upload",
            input: { ...payload, actor: human, studioAuthority: "interactive" },
          }),
        ).rejects.toThrow()
        const capability = z.object({ path: z.string() }).parse(
          actor.studioAuthority === "delegated"
            ? await executeStudioDelegated(db, caller, {
                action: "asset-upload",
                input: payload,
              })
            : await executeStudioInteractive(db, human, {
                action: "asset-upload",
                input: payload,
              }),
        )
        const uploaded = await transfer.upload(
          capability.path.split("/").at(-1)!,
          new ReadableStream({
            start(c) {
              c.enqueue(bytes)
              c.close()
            },
          }),
        )
        const asset = await new StudioAssetService(db).read(
          actor,
          uploaded.reference,
        )
        expect(asset.actor.authority).toBe(actor.studioAuthority)
        expect(asset.actor.id).toBe(id)
        expect(asset.actor.clientId).toBe(
          actor.studioAuthority === "delegated" ? "claude" : undefined,
        )
        await expect(
          transfer.download(capability.path.split("/").at(-1)!),
        ).rejects.toThrow()
        await expect(
          transfer.upload(
            capability.path.split("/").at(-1)!,
            new ReadableStream({
              start(c) {
                c.enqueue(Buffer.from("bad"))
                c.close()
              },
            }),
          ),
        ).rejects.toThrow("INVALID")
        const token = capability.path.split("/").at(-1)!
        await db.studioAssetTransfer.update({
          where: {
            tokenHash: createHash("sha256").update(token).digest("hex"),
          },
          data: { expiresAt: new Date(0) },
        })
        await expect(
          transfer.upload(token, new ReadableStream()),
        ).rejects.toThrow()
      }
    } finally {
      await db.$disconnect()
    }
  },
)
