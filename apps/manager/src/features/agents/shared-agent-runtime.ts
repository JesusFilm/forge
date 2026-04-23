import type { ManagerOverrideActor } from "@/lib/auth"
import type {
  SharedAgentRunRequest,
  SharedAgentRunResponse,
  SharedAgentSession,
} from "./shared-agent-contract"
import {
  SharedAgentAccessDeniedError,
  SharedAgentApprovalAlreadyResolvedError,
  SharedAgentApprovalNotFoundError,
  SharedAgentNotFoundError,
  SharedAgentSessionNotFoundError,
  SharedAgentValidationError,
  actOnSharedAgentApproval,
  createSharedAgentSession,
  getSharedAgentSessionSnapshot,
  listSharedAgentCatalog,
  runSharedAgentCompatibility,
  runSharedAgentSessionMessage,
} from "./shared-agent-control-plane"

export {
  SharedAgentAccessDeniedError,
  SharedAgentApprovalAlreadyResolvedError,
  SharedAgentApprovalNotFoundError,
  SharedAgentNotFoundError,
  SharedAgentSessionNotFoundError,
  SharedAgentValidationError,
  listSharedAgentCatalog,
}

export async function createSharedAgentSessionRuntime(input: {
  agentId: string
  videoDocumentId?: string
  actor?: ManagerOverrideActor
}): Promise<SharedAgentSession> {
  return createSharedAgentSession(input)
}

export function getSharedAgentSessionRuntime(input: {
  sessionId: string
  actor?: ManagerOverrideActor
}): SharedAgentSession {
  return getSharedAgentSessionSnapshot(input)
}

export async function sendSharedAgentSessionMessage(input: {
  sessionId: string
  actor?: ManagerOverrideActor
  locale?: string
  message?: string
  draft?: SharedAgentRunRequest
}): Promise<SharedAgentSession> {
  return runSharedAgentSessionMessage(input)
}

export async function resolveSharedAgentApproval(input: {
  approvalId: string
  action: "approve" | "decline"
  actor: ManagerOverrideActor
  locale?: string
}): Promise<SharedAgentSession> {
  return actOnSharedAgentApproval(input)
}

export async function runSharedAgent(input: {
  agentId: string
  payload: SharedAgentRunRequest
}): Promise<SharedAgentRunResponse> {
  return runSharedAgentCompatibility(input)
}
