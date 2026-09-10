import { studioCreativeDefaults, studioSourceDefaults } from "./defaults"
import { createHash, randomUUID } from "node:crypto"
import type {
  MastraStorage,
  AgentVersion,
  AgentInstructionBlock,
} from "@mastra/core/storage"
import { resolveInstructionBlocks } from "@mastra/editor"
import {
  STUDIO_AGENT_ID,
  STUDIO_BLOCK_ID,
  studioInstructionSelectionSchema,
} from "@forge/studio-contracts/agent"
import { z } from "zod"

export class StudioInstructionError extends Error {}
export const instructionDigest = (text: string) =>
  createHash("sha256").update(text).digest("hex")
const content = (version: AgentVersion) =>
  typeof version.instructions === "string"
    ? version.instructions
    : version.instructions
        .filter((b) => b.type === "text")
        .map((b) => b.content)
        .join("\n\n")
export type FrozenStudioInstructions = {
  effective: string
  agentVersionId: string
  agentDigest: string
  blockVersionId: string
  blockDigest: string
  digest: string
}

export type StudioInstructionProfile = {
  agentId: string
  blockId: string
  name: string
  defaults: string
  sourceDefaults: string
}
const authoringProfile: StudioInstructionProfile = {
  agentId: STUDIO_AGENT_ID,
  blockId: STUDIO_BLOCK_ID,
  name: "Studio authoring",
  defaults: studioCreativeDefaults,
  sourceDefaults: studioSourceDefaults,
}

/** Native storage only. Caller serializes mutations across replicas; bodies never leave this store for persistence. */
export class StudioInstructions {
  constructor(
    private readonly storage: MastraStorage,
    private readonly profile: StudioInstructionProfile = authoringProfile,
  ) {}
  private async stores() {
    const agents = await this.storage.getStore("agents"),
      blocks = await this.storage.getStore("promptBlocks")
    if (!agents || !blocks)
      throw new StudioInstructionError("Native instruction storage unavailable")
    return { agents, blocks }
  }
  async inspect() {
    const { agents, blocks } = await this.stores()
    if (!(await blocks.getById(this.profile.blockId))) {
      await blocks.create({
        promptBlock: {
          id: this.profile.blockId,
          name: this.profile.name + " source guidance",
          content: this.profile.sourceDefaults,
        },
      })
      const v = await blocks.getLatestVersion(this.profile.blockId)
      await blocks.update({
        id: this.profile.blockId,
        activeVersionId: v!.id,
        status: "published",
      })
    }
    if (!(await agents.getById(this.profile.agentId)))
      await agents.create({
        agent: {
          id: this.profile.agentId,
          name: this.profile.name,
          model: { provider: "code", name: "studio" },
          instructions: [
            { type: "text", content: this.profile.defaults },
            { type: "prompt_block_ref", id: this.profile.blockId },
          ],
        },
      })
    const row = await agents.getById(this.profile.agentId),
      latest = await agents.getLatestVersion(this.profile.agentId)
    const versions = await agents.listVersions({
      agentId: this.profile.agentId,
      perPage: 100,
      orderBy: { field: "versionNumber", direction: "DESC" },
    })
    const block = await blocks.getByIdResolved(this.profile.blockId, {
      status: "published",
    })
    return {
      suggestedDefaults: this.profile.defaults,
      activeVersionId: row!.activeVersionId ?? null,
      latest: { ...latest!, content: content(latest!) },
      versions: versions.versions.map((v) => ({ ...v, content: content(v) })),
      block,
    }
  }
  async save(expectedVersionId: string, text: string, actor: string) {
    z.string().min(1).max(16000).parse(text)
    const { agents } = await this.stores(),
      current = await this.inspect()
    if (current.latest.id !== expectedVersionId)
      throw new StudioInstructionError("CONFLICT")
    await agents.createVersion({
      id: randomUUID(),
      agentId: this.profile.agentId,
      versionNumber: current.latest.versionNumber + 1,
      name: this.profile.name,
      model: { provider: "code", name: "studio" },
      instructions: [
        { type: "text", content: text },
        { type: "prompt_block_ref", id: this.profile.blockId },
      ],
      changeMessage: `Draft saved by ${actor}`,
      changedFields: ["instructions"],
    })
    return this.inspect()
  }
  async activate(
    versionId: string,
    expectedActiveVersionId: string | null,
    actor: string,
  ) {
    const { agents } = await this.stores(),
      current = await this.inspect()
    if (current.activeVersionId !== expectedActiveVersionId)
      throw new StudioInstructionError("CONFLICT")
    const version = await agents.getVersion(versionId)
    if (!version || version.agentId !== this.profile.agentId)
      throw new StudioInstructionError("Unknown Studio version")
    await agents.update({
      id: this.profile.agentId,
      activeVersionId: versionId,
      status: "published",
      metadata: { activatedBy: actor },
    })
    return this.inspect()
  }
  async restore(versionId: string, expectedVersionId: string, actor: string) {
    const { agents } = await this.stores(),
      version = await agents.getVersion(versionId)
    if (!version || version.agentId !== this.profile.agentId)
      throw new StudioInstructionError("Unknown Studio version")
    return this.save(expectedVersionId, content(version), actor)
  }
  async compare(from: string, to: string) {
    const { agents } = await this.stores()
    const a = await agents.getVersion(from),
      b = await agents.getVersion(to)
    if (
      !a ||
      !b ||
      a.agentId !== this.profile.agentId ||
      b.agentId !== this.profile.agentId
    )
      throw new StudioInstructionError("Unknown Studio version")
    return {
      from: { id: a.id, content: content(a) },
      to: { id: b.id, content: content(b) },
    }
  }
  async freeze(
    raw: z.input<typeof studioInstructionSelectionSchema>,
    context: Record<string, string> = {},
  ): Promise<FrozenStudioInstructions> {
    const selection = studioInstructionSelectionSchema.parse(raw),
      { agents, blocks } = await this.stores()
    const row = await agents.getById(this.profile.agentId)
    if (
      !row ||
      (selection.mode === "active" &&
        (!row.activeVersionId || row.status !== "published"))
    )
      throw new StudioInstructionError(
        "Activate Studio instructions before running",
      )
    const agent = await agents.getVersion(
      selection.mode === "active" ? row.activeVersionId! : selection.versionId,
    )
    const blockRow = await blocks.getById(this.profile.blockId)
    const blockId =
      selection.mode === "active"
        ? blockRow?.activeVersionId
        : selection.blockVersionId
    const block = blockId ? await blocks.getVersion(blockId) : null
    if (
      !agent ||
      agent.agentId !== this.profile.agentId ||
      !block ||
      block.blockId !== this.profile.blockId ||
      (selection.mode === "active" && blockRow?.status !== "published")
    )
      throw new StudioInstructionError("Missing native instruction snapshot")
    const source: AgentInstructionBlock[] =
      typeof agent.instructions === "string"
        ? [{ type: "text", content: agent.instructions }]
        : agent.instructions
    const frozen = source.map((b) => {
      if (b.type !== "prompt_block_ref") return b
      if (b.id !== this.profile.blockId)
        throw new StudioInstructionError("Unknown Studio prompt block")
      return {
        type: "prompt_block" as const,
        content: block.content,
        rules: block.rules,
      }
    })
    // All refs are replaced with the already-read native snapshot. The native renderer performs no mutable lookup.
    const effective = await resolveInstructionBlocks(frozen, context, {
      promptBlocksStorage: blocks,
    })
    if (!effective.trim() || Buffer.byteLength(effective) > 32768)
      throw new StudioInstructionError("Invalid effective instructions")
    return {
      effective,
      agentVersionId: agent.id,
      agentDigest: instructionDigest(JSON.stringify(agent.instructions)),
      blockVersionId: block.id,
      blockDigest: instructionDigest(block.content),
      digest: instructionDigest(effective),
    }
  }
}
