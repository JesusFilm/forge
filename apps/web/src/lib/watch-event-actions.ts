"use server"

import { cookies } from "next/headers"
import { adminGraphql, type AdminVariablesOf } from "@forge/admin-graphql"

import {
  WEB_AUTH_SESSION_COOKIE,
  readWebAuthSessionCookie,
} from "@/auth/web-session"
import { createUserAdminClient } from "@/lib/admin-client"

const RECORD_WATCH_EVENT = adminGraphql(`
  mutation RecordWatchEvent(
    $videoId: ID!
    $videoDubId: ID
    $languageId: ID
    $eventType: WatchEventType!
    $positionSeconds: Int
    $durationSeconds: Int
    $progress: Float
    $requestSessionId: String
    $occurredAt: String
  ) {
    recordWatchEvent(
      videoId: $videoId
      videoDubId: $videoDubId
      languageId: $languageId
      eventType: $eventType
      positionSeconds: $positionSeconds
      durationSeconds: $durationSeconds
      progress: $progress
      requestSessionId: $requestSessionId
      occurredAt: $occurredAt
    ) {
      id
    }
  }
`)

type RecordWatchEventVariables = AdminVariablesOf<typeof RECORD_WATCH_EVENT>

export type RecordMeaningfulWatchEventInput = {
  videoId: string
  videoDubId?: string | null
  languageId?: string | null
  positionSeconds?: number | null
  durationSeconds?: number | null
  progress?: number | null
  requestSessionId?: string | null
}

type RecordWatchEventInput = RecordMeaningfulWatchEventInput & {
  eventType: "download" | "meaningful_playback"
}

export type RecordMeaningfulWatchEventResult =
  | { ok: true; recorded: true }
  | { ok: true; recorded: false; reason: "signed-out" }
  | { ok: false; reason: "upstream-error" }

function finiteInt(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return Math.max(0, Math.floor(value))
}

function finiteProgress(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return Math.min(1, Math.max(0, value))
}

function optionalId(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export async function recordMeaningfulWatchEvent(
  input: RecordMeaningfulWatchEventInput,
): Promise<RecordMeaningfulWatchEventResult> {
  const cookieStore = await cookies()
  const session = await readWebAuthSessionCookie(
    cookieStore.get(WEB_AUTH_SESSION_COOKIE)?.value,
  )
  if (!session) return { ok: true, recorded: false, reason: "signed-out" }

  return recordWatchEventWithAccessToken(session.accessToken, {
    ...input,
    eventType: "meaningful_playback",
  })
}

export async function recordWatchEventWithAccessToken(
  accessToken: string,
  input: RecordWatchEventInput,
): Promise<
  Exclude<RecordMeaningfulWatchEventResult, { reason: "signed-out" }>
> {
  const videoId = optionalId(input.videoId)
  if (!videoId) return { ok: false, reason: "upstream-error" }

  const variables = {
    videoId,
    videoDubId: optionalId(input.videoDubId),
    languageId: optionalId(input.languageId),
    eventType: input.eventType,
    positionSeconds: finiteInt(input.positionSeconds),
    durationSeconds: finiteInt(input.durationSeconds),
    progress: finiteProgress(input.progress),
    requestSessionId: optionalId(input.requestSessionId),
    occurredAt: new Date().toISOString(),
  } satisfies RecordWatchEventVariables

  try {
    await createUserAdminClient(accessToken).mutate({
      mutation: RECORD_WATCH_EVENT,
      variables,
    })
    return { ok: true, recorded: true }
  } catch (error) {
    console.warn("[watch-events] failed to record meaningful playback event", {
      error: error instanceof Error ? error.message : String(error),
      videoId,
      videoDubId: variables.videoDubId,
    })
    return { ok: false, reason: "upstream-error" }
  }
}
