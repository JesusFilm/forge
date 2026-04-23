import { randomUUID } from "node:crypto"
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"
import type {
  SharedAgentPendingApproval,
  SharedAgentRunRequest,
  SharedAgentRunResponse,
  SharedAgentSession,
  SharedAgentSessionMessage,
} from "./shared-agent-contract"

function cloneStoredValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function getStoreRoot(): string {
  return join(process.cwd(), ".tmp", "shared-agent-sessions")
}

function getSessionsRoot(): string {
  return join(getStoreRoot(), "sessions")
}

function getApprovalsRoot(): string {
  return join(getStoreRoot(), "approvals")
}

function getSessionFilePath(sessionId: string): string {
  return join(getSessionsRoot(), `${encodeURIComponent(sessionId)}.json`)
}

function getApprovalFilePath(approvalId: string): string {
  return join(getApprovalsRoot(), `${encodeURIComponent(approvalId)}.json`)
}

function writeJsonAtomically(filePath: string, value: unknown) {
  mkdirSync(dirname(filePath), { recursive: true })

  const tempFilePath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(tempFilePath, JSON.stringify(value, null, 2), "utf8")
  renameSync(tempFilePath, filePath)
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT") {
      return null
    }

    throw error
  }
}

function persistSession(session: SharedAgentSession): SharedAgentSession {
  const stored = cloneStoredValue(session)
  writeJsonAtomically(getSessionFilePath(stored.id), stored)

  if (stored.latestRun?.pendingApproval) {
    persistApproval(stored.latestRun.pendingApproval)
  }

  return cloneStoredValue(stored)
}

function persistApproval(
  approval: SharedAgentPendingApproval,
): SharedAgentPendingApproval {
  const stored = cloneStoredValue(approval)
  writeJsonAtomically(getApprovalFilePath(stored.id), stored)
  return cloneStoredValue(stored)
}

function readSession(sessionId: string): SharedAgentSession | null {
  return readJsonFile<SharedAgentSession>(getSessionFilePath(sessionId))
}

function readApproval(approvalId: string): SharedAgentPendingApproval | null {
  return readJsonFile<SharedAgentPendingApproval>(
    getApprovalFilePath(approvalId),
  )
}

export function resetSharedAgentSessionStore() {
  rmSync(getStoreRoot(), { recursive: true, force: true })
}

export function saveSharedAgentSession(
  session: SharedAgentSession,
): SharedAgentSession {
  return persistSession(session)
}

export function getSharedAgentSession(
  sessionId: string,
): SharedAgentSession | null {
  const session = readSession(sessionId)
  return session ? cloneStoredValue(session) : null
}

export function appendSharedAgentSessionMessage(input: {
  sessionId: string
  message: SharedAgentSessionMessage
}): SharedAgentSession | null {
  const session = readSession(input.sessionId)
  if (!session) return null

  const next: SharedAgentSession = {
    ...session,
    updatedAt: input.message.createdAt,
    messages: [...session.messages, cloneStoredValue(input.message)],
  }

  return persistSession(next)
}

export function recordSharedAgentSessionRun(input: {
  sessionId: string
  run: SharedAgentRunResponse
  latestDraft: SharedAgentRunRequest | null
}): SharedAgentSession | null {
  const session = readSession(input.sessionId)
  if (!session) return null

  const next: SharedAgentSession = {
    ...session,
    updatedAt: input.run.generatedAt,
    latestRun: cloneStoredValue({
      ...input.run,
      sessionId: input.sessionId,
    }),
    latestDraft: input.latestDraft ? cloneStoredValue(input.latestDraft) : null,
  }

  return persistSession(next)
}

export function getSharedAgentPendingApproval(
  approvalId: string,
): SharedAgentPendingApproval | null {
  const approval = readApproval(approvalId)
  if (!approval || approval.status !== "pending") {
    return null
  }

  return cloneStoredValue(approval)
}

export function getSharedAgentApprovalRecord(
  approvalId: string,
): SharedAgentPendingApproval | null {
  const approval = readApproval(approvalId)
  return approval ? cloneStoredValue(approval) : null
}

export function saveSharedAgentRecommendationSummary(input: {
  sessionId: string
  summary: string
  savedAt: string
}): SharedAgentSession | null {
  const session = readSession(input.sessionId)
  if (!session) return null

  const next: SharedAgentSession = {
    ...session,
    updatedAt: input.savedAt,
    savedRecommendationSummary: input.summary,
  }

  return persistSession(next)
}

export function resolveSharedAgentPendingApproval(input: {
  approvalId: string
  status: "approved" | "declined"
  actor: string
  resolvedAt: string
}): {
  approval: SharedAgentPendingApproval
  session: SharedAgentSession | null
} | null {
  const approval = readApproval(input.approvalId)
  if (!approval || approval.status !== "pending") {
    return null
  }

  const nextApproval: SharedAgentPendingApproval = {
    ...approval,
    actor: input.actor,
    status: input.status,
    resolvedAt: input.resolvedAt,
  }
  persistApproval(nextApproval)

  const session = readSession(approval.sessionId)
  if (!session) {
    return {
      approval: cloneStoredValue(nextApproval),
      session: null,
    }
  }

  const nextSession: SharedAgentSession = {
    ...session,
    updatedAt: input.resolvedAt,
    latestRun:
      session.latestRun &&
      session.latestRun.pendingApproval?.id === input.approvalId
        ? {
            ...session.latestRun,
            pendingApproval: cloneStoredValue(nextApproval),
          }
        : session.latestRun,
  }

  return {
    approval: cloneStoredValue(nextApproval),
    session: persistSession(nextSession),
  }
}
