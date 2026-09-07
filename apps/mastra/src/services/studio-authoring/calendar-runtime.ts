import { StudioRunBudget, type StudioSettlement } from "./run-budget"
import { createHmac, timingSafeEqual } from "node:crypto"
import type { MastraStorage } from "@mastra/core/storage"
import type { AgentConfig } from "@mastra/core/agent"
import { z } from "zod"
import { calendarRuntimeRequestSchema } from "@forge/studio-contracts/calendar"
import {
  readStudioBytes,
  verifyStudioRequest,
  studioHash,
  StudioBoundaryError,
} from "@forge/studio-server"
import {
  createCalendarInstructions,
  streamCalendarPlan,
} from "./calendar-planner"

const admissionSchema = z
  .object({
    runId: z.string(),
    caller: z.string(),
    authority: z.enum(["interactive", "delegated"]),
    contextDigest: z.string(),
    agentVersionId: z.string(),
    blockVersionId: z.string(),
    agentDigest: z.string(),
    blockDigest: z.string(),
    digest: z.string(),
    expires: z.number(),
  })
  .strict()
type Config = {
  publicKeys: string
  environment: string
  admissionSecret: string
  model: AgentConfig["model"]
  serialize: <T>(work: () => Promise<T>) => Promise<T>
  claim: (id: string, digest: string) => Promise<boolean>
  finish: (
    id: string,
    status: "completed" | "failed",
    context: StudioSettlement,
  ) => Promise<void>
}
/** Authentication and signed immutable input precede native initialization and execution. */
export function createCalendarRuntime(storage: MastraStorage, config: Config) {
  const instructions = createCalendarInstructions(storage)
  let initialized: Promise<void> | undefined
  const mac = (value: string) =>
    createHmac("sha256", config.admissionSecret).update(value).digest()
  return async (request: Request): Promise<Response> => {
    const budget = new StudioRunBudget(request.signal, () => {}, {
      runMs: 60000,
      stepMs: 55000,
      persistenceMs: 5000,
    })
    try {
      const prepared = await budget.run(async () => {
        const body = await readStudioBytes(request, 262144)
        const caller = await verifyStudioRequest(
          request.headers.get("x-forge-studio-service"),
          body,
          "forge-mastra:studio-calendar",
          config,
        )
        const command = calendarRuntimeRequestSchema.parse(JSON.parse(body))
        if (
          !caller.scopes.includes(
            command.action === "instructions"
              ? "studio:instructions:read"
              : "studio:calendar:plan",
          )
        )
          throw new StudioBoundaryError("Calendar scope required")
        if (
          command.action === "instructions" &&
          !["inspect", "compare"].includes(command.command.action) &&
          caller.authority !== "interactive"
        )
          throw new StudioBoundaryError(
            "Interactive instruction authority required",
          )
        initialized ??= storage.init().catch((error) => {
          initialized = undefined
          throw error
        })
        await initialized
        if (command.action === "instructions") {
          const c = command.command
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
          return {
            kind: "response" as const,
            response: Response.json({ result }),
          }
        }
        const contextDigest = studioHash(command.input)
        if (command.action === "freeze") {
          const frozen = await config.serialize(() =>
            instructions.freeze(
              { mode: "active" },
              { language: command.input.language },
            ),
          )
          const payload = Buffer.from(
            JSON.stringify({
              runId: command.runId,
              caller: caller.sub,
              authority: caller.authority,
              contextDigest,
              agentVersionId: frozen.agentVersionId,
              blockVersionId: frozen.blockVersionId,
              agentDigest: frozen.agentDigest,
              blockDigest: frozen.blockDigest,
              digest: frozen.digest,
              expires: Date.now() + 300000,
            }),
          ).toString("base64url")
          return {
            kind: "response" as const,
            response: Response.json({
              result: {
                admission: payload + "." + mac(payload).toString("base64url"),
              },
            }),
          }
        }
        const [payload, signature, ...extra] = command.admission.split(".")
        const actual = Buffer.from(signature ?? "", "base64url"),
          expected = mac(payload ?? "")
        if (
          extra.length ||
          actual.length !== expected.length ||
          !timingSafeEqual(actual, expected)
        )
          throw new StudioBoundaryError("Invalid calendar admission")
        const bound = admissionSchema.parse(
          JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
        )
        if (
          bound.runId !== command.runId ||
          bound.caller !== caller.sub ||
          bound.authority !== caller.authority ||
          bound.contextDigest !== contextDigest ||
          bound.expires < Date.now()
        )
          throw new StudioBoundaryError("Stale calendar admission")
        const frozen = await config.serialize(() =>
          instructions.freeze(
            {
              mode: "version",
              versionId: bound.agentVersionId,
              blockVersionId: bound.blockVersionId,
            },
            { language: command.input.language },
          ),
        )
        if (
          frozen.digest !== bound.digest ||
          frozen.agentDigest !== bound.agentDigest ||
          frozen.blockDigest !== bound.blockDigest
        )
          throw new StudioBoundaryError("Native calendar version changed")
        if (
          !(await config.claim("calendar:" + command.runId, studioHash(bound)))
        )
          throw new StudioBoundaryError(
            "Calendar run already claimed; do not replay",
            409,
          )
        return { kind: "execution" as const, command, frozen }
      })
      if (prepared.kind === "response") return prepared.response
      const { command, frozen } = prepared
      let result
      try {
        result = await budget.run(() =>
          streamCalendarPlan({
            input: command.input,
            frozen,
            model: config.model,
            signal: budget.signal,
          }),
        )
      } catch (error) {
        await budget.settle((context) =>
          config.finish("calendar:" + command.runId, "failed", context),
        )
        throw error
      }
      // A lost terminal-write response is ambiguous. Never issue a second,
      // contradictory transition or replay a consumed native claim.
      await budget.settle((context) =>
        config.finish("calendar:" + command.runId, "completed", context),
      )
      return Response.json({ result })
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof StudioBoundaryError
              ? error.message
              : "Calendar planning failed; no result applied",
        },
        { status: error instanceof StudioBoundaryError ? error.status : 400 },
      )
    } finally {
      budget.close()
    }
  }
}
