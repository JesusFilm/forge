import {
  randomUUID,
  createHmac,
  createHash,
  timingSafeEqual,
} from "node:crypto"
import type { MastraStorage } from "@mastra/core/storage"
import type { AgentConfig } from "@mastra/core/agent"
import {
  studioRuntimeRequestSchema,
  type StudioAgentEvent,
} from "@forge/studio-contracts/agent"
import {
  verifyStudioRequest,
  readStudioBytes,
  StudioBoundaryError,
} from "@forge/studio-server"
import {
  StudioInstructions,
  StudioInstructionError,
  type FrozenStudioInstructions,
} from "./instructions"
import { streamStudioAgent, StudioToolProgressError } from "./agent"
import { rejectStudioAssetTool } from "./tool-feedback"
import {
  StudioRunBudget,
  StudioRunDeadlineError,
  type StudioSettlement,
  type StudioRunTelemetry,
} from "./run-budget"

type Config = {
  adminUrl?: string
  publicKeys: string
  environment: string
  model: AgentConfig["model"]
  admissionSecret: string
  claim: (id: string, digest: string) => Promise<boolean>
  finish: (
    id: string,
    status: "completed" | "failed",
    context: StudioSettlement,
  ) => Promise<void>
  report?: (event: StudioRunTelemetry & { attemptId?: string }) => void
  serialize: <T>(work: () => Promise<T>) => Promise<T>
}
/** Private hosted route; authentication precedes every native storage/model operation. */
export function createStudioRuntime(storage: MastraStorage, config: Config) {
  const instructions = new StudioInstructions(storage)
  let initialized: Promise<void> | undefined

  return async (request: Request): Promise<Response> => {
    try {
      const body = await readStudioBytes(request)
      const caller = await verifyStudioRequest(
        request.headers.get("x-forge-studio-service"),
        body,
        "forge-mastra:studio",
        config,
      )
      const command = studioRuntimeRequestSchema.parse(JSON.parse(body))
      // Lazy native initialization follows authentication; retry a failed connection.
      initialized ??= storage.init().catch((error) => {
        initialized = undefined
        throw error
      })
      await initialized
      if (command.action === "instructions") {
        const c = command.command
        const read = c.action === "inspect" || c.action === "compare"
        if (
          !caller.scopes.includes("studio:instructions:read") ||
          (!read && caller.authority !== "interactive")
        )
          throw new StudioBoundaryError(
            "Interactive instruction authority required",
          )
        const result = await config.serialize(async () => {
          switch (c.action) {
            case "inspect":
              return instructions.inspect()
            case "save":
              return instructions.save(
                c.expectedVersionId,
                c.content,
                caller.sub,
              )
            case "activate":
              return instructions.activate(
                c.versionId,
                c.expectedActiveVersionId,
                caller.sub,
              )
            case "restore":
              return instructions.restore(
                c.versionId,
                c.expectedVersionId,
                caller.sub,
              )
            case "compare":
              return instructions.compare(c.from, c.to)
          }
        })
        return Response.json({ result })
      }
      if (!caller.scopes.includes("studio:chat"))
        throw new StudioBoundaryError("Studio chat scope required")
      if (command.action === "freeze") {
        const frozen = await config.serialize(() =>
          instructions.freeze(
            { mode: "active" },
            { language: command.project.document.language },
          ),
        )
        const provenance = {
          agentVersionId: frozen.agentVersionId,
          agentDigest: frozen.agentDigest,
          blockVersionId: frozen.blockVersionId,
          blockDigest: frozen.blockDigest,
          digest: frozen.digest,
        }
        const payload = Buffer.from(
          JSON.stringify({
            id: randomUUID(),
            attemptId: null,
            user: caller.sub,
            expires: Date.now() + 300000,
            projectId: command.input.projectId,
            revision: command.input.expectedRevision,
            inputKey: command.input.idempotencyKey,
            messageDigest: createHmac("sha256", config.admissionSecret)
              .update(command.input.message)
              .digest("hex"),
            projectDigest: createHash("sha256")
              .update(JSON.stringify(command.project.document))
              .digest("hex"),
            context: { language: command.project.document.language },
            ...provenance,
          }),
        ).toString("base64url")
        const admission =
          payload +
          "." +
          createHmac("sha256", config.admissionSecret)
            .update(payload)
            .digest("base64url")
        return Response.json({ result: { admission, provenance } })
      }
      if (command.action === "test") {
        if (caller.authority !== "interactive")
          throw new StudioBoundaryError("Interactive instruction test required")
        const frozen = await config.serialize(() =>
          instructions.freeze(command.selection, {
            language: command.language,
          }),
        )
        // Test uses the same fixed agent and exact native bytes, without project writes or live activation.
        const project = {
          projectId: "instruction-test",
          revision: 1,
          lifecycle: "DRAFT" as const,
          firstPublishedAt: null,
          actor: { kind: "human" as const, id: caller.sub },
          document: {
            version: 1 as const,
            runtimeVersion: "instruction-test",
            title: "Instruction test",
            language: command.language,
            width: 1080,
            height: 1920,
            fps: 30,
            durationInFrames: 300,
            tracks: [],
            items: [],
            components: [],
            packRevisionIds: [],
          },
        }
        return streaming(
          frozen,
          project,
          command.message,
          config,
          request.signal,
        )
      }
      const [payload, signature] = command.admission.split(".")
      if (!payload || !signature)
        throw new StudioBoundaryError("Invalid admission")
      const expected = createHmac("sha256", config.admissionSecret)
          .update(payload)
          .digest(),
        actual = Buffer.from(signature, "base64url")
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        throw new StudioBoundaryError("Invalid admission")
      const admission = JSON.parse(
        Buffer.from(payload, "base64url").toString("utf8"),
      ) as {
        id: string
        attemptId: string | null
        user: string
        expires: number
        agentVersionId: string
        blockVersionId: string
        digest: string
        agentDigest: string
        blockDigest: string
        projectId: string
        revision: number
        inputKey: string
        messageDigest: string
        projectDigest: string
        context: { language: string }
      }
      if (admission.user !== caller.sub || admission.expires < Date.now())
        throw new StudioBoundaryError(
          "Instruction admission expired; create a new attempt",
          409,
        )
      if (
        admission.projectDigest !==
          createHash("sha256")
            .update(JSON.stringify(command.project.document))
            .digest("hex") ||
        admission.context.language !== command.project.document.language ||
        admission.projectId !== command.project.projectId ||
        admission.revision !== command.project.revision ||
        admission.inputKey !== command.inputKey ||
        admission.messageDigest !==
          createHmac("sha256", config.admissionSecret)
            .update(command.message)
            .digest("hex")
      )
        throw new StudioBoundaryError("Admission input mismatch", 409)
      if (command.action === "bind") {
        if (admission.attemptId && admission.attemptId !== command.attemptId)
          throw new StudioBoundaryError("Admission already bound", 409)
        const bound = Buffer.from(
          JSON.stringify({ ...admission, attemptId: command.attemptId }),
        ).toString("base64url")
        return Response.json({
          result: {
            admission:
              bound +
              "." +
              createHmac("sha256", config.admissionSecret)
                .update(bound)
                .digest("base64url"),
          },
        })
      }
      if (admission.attemptId !== command.attemptId)
        throw new StudioBoundaryError("Admission attempt mismatch", 409)
      const frozen = await instructions.freeze(
        {
          mode: "version",
          versionId: admission.agentVersionId,
          blockVersionId: admission.blockVersionId,
        },
        admission.context,
      )
      if (
        frozen.digest !== admission.digest ||
        frozen.agentDigest !== admission.agentDigest ||
        frozen.blockDigest !== admission.blockDigest
      )
        throw new StudioBoundaryError("Admitted native snapshot changed", 409)
      if (!(await config.claim(command.attemptId, frozen.digest)))
        throw new StudioBoundaryError(
          "Admission already executed; inspect the existing attempt",
          409,
        )
      return streaming(
        frozen,
        command.project,
        command.message,
        config,
        request.signal,
        command.attemptId,
        command.toolGrant,
      )
    } catch (e) {
      return Response.json(
        {
          error:
            e instanceof StudioInstructionError ||
            e instanceof StudioBoundaryError
              ? e.message
              : "Invalid Studio runtime request",
        },
        {
          status:
            e instanceof StudioBoundaryError
              ? e.status
              : e instanceof StudioInstructionError && e.message === "CONFLICT"
                ? 409
                : 400,
        },
      )
    }
  }
}
function streaming(
  frozen: FrozenStudioInstructions,
  project: Parameters<typeof streamStudioAgent>[0]["project"],
  message: string,
  config: Config,
  signal: AbortSignal,
  attemptId?: string,
  toolGrant?: { body: string; assertion: string },
) {
  const cancelled = new AbortController()
  const budget = new StudioRunBudget(
    AbortSignal.any([signal, cancelled.signal]),
    (event) => {
      config.report?.({ ...event, ...(attemptId ? { attemptId } : {}) })
    },
  )
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: StudioAgentEvent) => {
        if (!budget.signal.aborted)
          controller.enqueue(
            new TextEncoder().encode(JSON.stringify(event) + "\n"),
          )
      }
      void (async () => {
        let failure: unknown
        let failed = false
        try {
          await budget.run(() =>
            streamStudioAgent({
              frozen,
              project,
              message,
              model: config.model,
              emit,
              signal: budget.signal,
              budget,
              assetCall:
                toolGrant && config.adminUrl
                  ? async (action, input) => {
                      const response = await fetch(
                        new URL("/api/studio/tools", config.adminUrl),
                        {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({
                            grant: toolGrant,
                            action,
                            input,
                          }),
                          redirect: "error",
                          signal: budget.signal,
                        },
                      )
                      if (!response.ok)
                        await rejectStudioAssetTool(action, response)
                      const result = JSON.parse(
                        await readStudioBytes(response),
                      ) as {
                        result: unknown
                      }
                      if (action === "asset-upload") {
                        const transfer = result.result as { path: string }
                        if (
                          !/^\/api\/studio\/assets\/transfer\/[a-f0-9]{64}$/.test(
                            transfer.path,
                          )
                        )
                          throw new StudioBoundaryError("Invalid transfer path")
                        return {
                          ...transfer,
                          url: new URL(
                            transfer.path,
                            config.adminUrl,
                          ).toString(),
                        }
                      }
                      return result.result
                    }
                  : undefined,
            }),
          )
        } catch (error) {
          failed = true
          failure = budget.reason ?? error
        }
        try {
          if (attemptId)
            await budget.settle((context) =>
              config.finish(
                attemptId,
                failed ? "failed" : "completed",
                context,
              ),
            )
        } catch (error) {
          // A timed-out terminal write is ambiguous. Never retry it as failed.
          failed = true
          failure = error
        }
        try {
          if (!failed) emit({ type: "done" })
          else if (!signal.aborted && !cancelled.signal.aborted)
            controller.enqueue(
              new TextEncoder().encode(
                JSON.stringify({
                  type: "error",
                  message:
                    failure instanceof StudioToolProgressError ||
                    failure instanceof StudioRunDeadlineError
                      ? failure.message
                      : "Studio generation failed. No proposed changes were applied.",
                }) + "\n",
              ),
            )
        } finally {
          budget.close()
          try {
            controller.close()
          } catch {
            /* cancelled reader */
          }
        }
      })()
    },
    cancel() {
      cancelled.abort()
      budget.close()
    },
  })
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  })
}
