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
const initialText =
  "Help the operator author a video. Explain your proposed edits. Use only the supplied project and approved assets. Never claim review, narration, rendering or publication has occurred."
const blockText =
  "Keep source evidence separate from editorial instructions. Preserve exact source language and attribution."
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

/** Native storage only. Caller serializes mutations across replicas; bodies never leave this store for persistence. */
export class StudioInstructions {
  constructor(private readonly storage: MastraStorage) {}
  private async stores() {
    const agents = await this.storage.getStore("agents"),
      blocks = await this.storage.getStore("promptBlocks")
    if (!agents || !blocks)
      throw new StudioInstructionError("Native instruction storage unavailable")
    return { agents, blocks }
  }
  async inspect() {
    const { agents, blocks } = await this.stores()
    if (!(await blocks.getById(STUDIO_BLOCK_ID))) {
      await blocks.create({
        promptBlock: {
          id: STUDIO_BLOCK_ID,
          name: "Studio source guidance",
          content: blockText,
        },
      })
      const v = await blocks.getLatestVersion(STUDIO_BLOCK_ID)
      await blocks.update({
        id: STUDIO_BLOCK_ID,
        activeVersionId: v!.id,
        status: "published",
      })
    }
    if (!(await agents.getById(STUDIO_AGENT_ID)))
      await agents.create({
        agent: {
          id: STUDIO_AGENT_ID,
          name: "Studio authoring",
          model: { provider: "code", name: "studio" },
          instructions: [
            { type: "text", content: initialText },
            { type: "prompt_block_ref", id: STUDIO_BLOCK_ID },
          ],
        },
      })
    const row = await agents.getById(STUDIO_AGENT_ID),
      latest = await agents.getLatestVersion(STUDIO_AGENT_ID)
    const versions = await agents.listVersions({
      agentId: STUDIO_AGENT_ID,
      perPage: 100,
      orderBy: { field: "versionNumber", direction: "DESC" },
    })
    const block = await blocks.getByIdResolved(STUDIO_BLOCK_ID, {
      status: "published",
    })
    return {
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
      agentId: STUDIO_AGENT_ID,
      versionNumber: current.latest.versionNumber + 1,
      name: "Studio authoring",
      model: { provider: "code", name: "studio" },
      instructions: [
        { type: "text", content: text },
        { type: "prompt_block_ref", id: STUDIO_BLOCK_ID },
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
    if (!version || version.agentId !== STUDIO_AGENT_ID)
      throw new StudioInstructionError("Unknown Studio version")
    await agents.update({
      id: STUDIO_AGENT_ID,
      activeVersionId: versionId,
      status: "published",
      metadata: { activatedBy: actor },
    })
    return this.inspect()
  }
  async restore(versionId: string, expectedVersionId: string, actor: string) {
    const { agents } = await this.stores(),
      version = await agents.getVersion(versionId)
    if (!version || version.agentId !== STUDIO_AGENT_ID)
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
      a.agentId !== STUDIO_AGENT_ID ||
      b.agentId !== STUDIO_AGENT_ID
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
    const row = await agents.getById(STUDIO_AGENT_ID)
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
    const blockRow = await blocks.getById(STUDIO_BLOCK_ID)
    const blockId =
      selection.mode === "active"
        ? blockRow?.activeVersionId
        : selection.blockVersionId
    const block = blockId ? await blocks.getVersion(blockId) : null
    if (
      !agent ||
      agent.agentId !== STUDIO_AGENT_ID ||
      !block ||
      block.blockId !== STUDIO_BLOCK_ID ||
      (selection.mode === "active" && blockRow?.status !== "published")
    )
      throw new StudioInstructionError("Missing native instruction snapshot")
    const source: AgentInstructionBlock[] =
      typeof agent.instructions === "string"
        ? [{ type: "text", content: agent.instructions }]
        : agent.instructions
    const frozen = source.map((b) => {
      if (b.type !== "prompt_block_ref") return b
      if (b.id !== STUDIO_BLOCK_ID)
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
