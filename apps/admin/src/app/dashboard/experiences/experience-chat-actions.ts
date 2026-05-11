/**
 * Experience-chat thread CRUD actions.
 *
 * Pure functions taking deps + input → result. The `[id]/page.tsx` server
 * component wraps these in `"use server"` thunks so the client panel can
 * call them. Keeping the cores plain makes them unit-testable without
 * needing the Next runtime.
 *
 * Every action enforces ABAC via `canEditExperienceLocale` against the
 * locale's parent experience. Failures throw `ForbiddenError` so the
 * caller can branch on `instanceof`.
 */

import type { LocaleStatus } from "@prisma/client"

import { canEditExperienceLocale } from "@/auth/permissions"
import type { Principal } from "@/auth/principal"
import { ForbiddenError, NotFoundError } from "@/services/errors"

/**
 * Loose prisma facade — typed as `any` so the structural-typing burden
 * doesn't force tests to mock 18+ delegate methods (`findFirstOrThrow`,
 * `aggregate`, `groupBy`, etc.) that this module never calls. The real
 * `PrismaClient` flows through unchanged; test mocks supply a partial
 * spy object satisfying only the call sites used here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ChatActionPrismaShape = any

export type ChatActionDeps = {
  prisma: ChatActionPrismaShape
  user: Principal | null
}

type LocaleAuthRow = {
  id: string
  status: LocaleStatus
  experienceId: string | null
  experience: { ownerId: string | null; archivedAt: Date | null }
}

export type ChatThreadDTO = {
  id: string
  title: string
  createdAt: string
  lastMessageAt: string
}

export type ChatMessageDTO = {
  id: string
  role: "USER" | "ASSISTANT" | "SYSTEM"
  content: string
  createdAt: string
  snapshotDiff: unknown
  mutationsApplied: unknown
}

const TITLE_WORD_LIMIT = 6

/**
 * Truncate a free-form prompt to a stable thread title — six words plus
 * an ellipsis. Empty input falls back to "New conversation".
 */
export function summarizeFirstPromptToTitle(prompt: string): string {
  const trimmed = prompt.trim()
  if (trimmed.length === 0) return "New conversation"
  const words = trimmed.split(/\s+/)
  if (words.length <= TITLE_WORD_LIMIT) return words.join(" ")
  return words.slice(0, TITLE_WORD_LIMIT).join(" ") + "…"
}

async function loadLocaleForAuth(
  deps: ChatActionDeps,
  experienceLocaleId: string,
): Promise<LocaleAuthRow> {
  const locale = (await deps.prisma.experienceLocale.findUnique({
    where: { id: experienceLocaleId },
    select: {
      id: true,
      status: true,
      experienceId: true,
      experience: {
        select: { ownerId: true, archivedAt: true },
      },
    },
  })) as LocaleAuthRow | null
  if (!locale) throw new NotFoundError("ExperienceLocale", experienceLocaleId)
  return locale
}

async function loadThreadForAuth(
  deps: ChatActionDeps,
  threadId: string,
): Promise<{
  id: string
  experienceLocaleId: string
  locale: LocaleAuthRow
}> {
  const thread = (await deps.prisma.experienceChatThread.findUnique({
    where: { id: threadId },
    select: {
      id: true,
      experienceLocaleId: true,
      experienceLocale: {
        select: {
          id: true,
          status: true,
          experienceId: true,
          experience: {
            select: { ownerId: true, archivedAt: true },
          },
        },
      },
    },
  })) as {
    id: string
    experienceLocaleId: string
    experienceLocale: LocaleAuthRow | null
  } | null
  if (!thread || !thread.experienceLocale) {
    throw new NotFoundError("ExperienceChatThread", threadId)
  }
  return {
    id: thread.id,
    experienceLocaleId: thread.experienceLocaleId,
    locale: thread.experienceLocale,
  }
}

export async function listThreadsAction(
  deps: ChatActionDeps,
  input: { experienceLocaleId: string },
): Promise<ChatThreadDTO[]> {
  const locale = await loadLocaleForAuth(deps, input.experienceLocaleId)
  if (!canEditExperienceLocale(deps.user, locale)) {
    throw new ForbiddenError(
      "You do not have permission to view chat threads for this locale",
    )
  }

  const rows = await deps.prisma.experienceChatThread.findMany({
    where: { experienceLocaleId: input.experienceLocaleId, archivedAt: null },
    orderBy: { lastMessageAt: "desc" },
    select: {
      id: true,
      title: true,
      createdAt: true,
      lastMessageAt: true,
    },
  })

  return (
    rows as Array<{
      id: string
      title: string
      createdAt: Date
      lastMessageAt: Date
    }>
  ).map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    lastMessageAt: row.lastMessageAt.toISOString(),
  }))
}

export async function createThreadAction(
  deps: ChatActionDeps,
  input: { experienceLocaleId: string; firstPrompt: string },
): Promise<ChatThreadDTO> {
  const locale = await loadLocaleForAuth(deps, input.experienceLocaleId)
  if (!canEditExperienceLocale(deps.user, locale)) {
    throw new ForbiddenError(
      "You do not have permission to create chat threads for this locale",
    )
  }
  if (!deps.user?.id) {
    throw new ForbiddenError("Authenticated session required")
  }

  const title = summarizeFirstPromptToTitle(input.firstPrompt)

  const created = await deps.prisma.experienceChatThread.create({
    data: {
      experienceLocaleId: input.experienceLocaleId,
      title,
      createdByUserId: deps.user.id,
    },
    select: {
      id: true,
      title: true,
      createdAt: true,
      lastMessageAt: true,
    },
  })

  return {
    id: created.id,
    title: created.title,
    createdAt: created.createdAt.toISOString(),
    lastMessageAt: created.lastMessageAt.toISOString(),
  }
}

export async function archiveThreadAction(
  deps: ChatActionDeps,
  input: { threadId: string },
): Promise<{ id: string; archivedAt: string }> {
  const thread = await loadThreadForAuth(deps, input.threadId)
  if (!canEditExperienceLocale(deps.user, thread.locale)) {
    throw new ForbiddenError(
      "You do not have permission to archive this chat thread",
    )
  }

  const updated = await deps.prisma.experienceChatThread.update({
    where: { id: thread.id },
    data: { archivedAt: new Date() },
    select: { id: true, archivedAt: true },
  })

  return {
    id: updated.id,
    archivedAt: (updated.archivedAt ?? new Date()).toISOString(),
  }
}

export async function getMessagesAction(
  deps: ChatActionDeps,
  input: { threadId: string },
): Promise<ChatMessageDTO[]> {
  const thread = await loadThreadForAuth(deps, input.threadId)
  if (!canEditExperienceLocale(deps.user, thread.locale)) {
    throw new ForbiddenError(
      "You do not have permission to read this chat thread",
    )
  }

  const rows = await deps.prisma.experienceChatMessage.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      content: true,
      createdAt: true,
      snapshotDiff: true,
      mutationsApplied: true,
    },
  })

  return (
    rows as Array<{
      id: string
      role: "USER" | "ASSISTANT" | "SYSTEM"
      content: string
      createdAt: Date
      snapshotDiff: unknown
      mutationsApplied: unknown
    }>
  ).map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    snapshotDiff: row.snapshotDiff,
    mutationsApplied: row.mutationsApplied,
  }))
}
