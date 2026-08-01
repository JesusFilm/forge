import type { SupportResearchConfig } from "../../config/env"
import type {
  HelpScoutClient,
  HelpScoutConversation,
  HelpScoutFailure,
  HelpScoutResult,
  HelpScoutThread,
} from "./help-scout-client"
import {
  sanitizeSupportConversation,
  type RawSupportConversation,
} from "./sanitize-support-content"
import type { SanitizedSupportConversation } from "./schema"

export type SupportSourceClient = Pick<
  HelpScoutClient,
  "listNewConversations" | "listThreads"
>

export type SupportIngestionResult = {
  conversations: SanitizedSupportConversation[]
  cursorProgress: Date
  partial: boolean
  capped: boolean
  pages: number
  exclusions: Array<{ sourceId: string; reason: string }>
  failure?: HelpScoutFailure
}

function later(left: Date, right: Date): Date {
  return left > right ? left : right
}

export async function ingestSupportConversations(input: {
  client: SupportSourceClient
  config: Pick<
    SupportResearchConfig,
    "allowedWatchHosts" | "maxConversations" | "maxSanitizedCharacters"
  >
  createdAfter: Date
  createdBefore: Date
}): Promise<SupportIngestionResult> {
  const listed = await input.client.listNewConversations({
    createdAfter: input.createdAfter,
    createdBefore: input.createdBefore,
    maxConversations: input.config.maxConversations,
  })
  if (!listed.ok) {
    return {
      conversations: [],
      cursorProgress: input.createdAfter,
      partial: true,
      capped: false,
      pages: 0,
      exclusions: [],
      failure: listed,
    }
  }

  const sanitized: SanitizedSupportConversation[] = []
  const exclusions: SupportIngestionResult["exclusions"] = []
  let cursorProgress = input.createdAfter
  let pages = listed.value.pages
  let capped = listed.value.capped
  for (const conversation of listed.value.conversations) {
    const threads = await input.client.listThreads(conversation.id)
    if (!threads.ok) {
      if (threads.reason === "not_found") {
        exclusions.push({ sourceId: conversation.id, reason: "not_found" })
        cursorProgress = later(cursorProgress, new Date(conversation.createdAt))
        continue
      }
      return {
        conversations: sanitized,
        cursorProgress,
        partial: true,
        capped: listed.value.capped,
        pages,
        exclusions,
        failure: threads,
      }
    }

    const raw: RawSupportConversation = {
      sourceId: threads.value.mergedIntoId ?? conversation.id,
      mailboxId: conversation.mailboxId,
      createdAt: conversation.createdAt,
      sourceUrl: conversation.sourceUrl,
      subject: conversation.subject,
      threadBodies: threads.value.threads.map((thread) => thread.body),
      truncated: threads.value.capped,
    }
    capped ||= threads.value.capped
    pages += threads.value.pages
    sanitized.push(
      sanitizeSupportConversation({
        conversation: raw,
        allowedWatchHosts: input.config.allowedWatchHosts,
        maxCharacters: input.config.maxSanitizedCharacters,
      }),
    )
    cursorProgress = later(cursorProgress, new Date(conversation.createdAt))
  }

  return {
    conversations: sanitized,
    cursorProgress,
    partial: capped,
    capped,
    pages,
    exclusions,
  }
}

export type { HelpScoutConversation, HelpScoutResult, HelpScoutThread }
