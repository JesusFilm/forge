"use server"

import { revalidatePath } from "next/cache"
import { requireSession } from "@/auth/session"
import { prisma } from "@/db/client"
import { createServices } from "@/services"
import {
  mapVideoSearchSocialError,
  type VideoSearchSocialMetadata,
  type VideoSearchSocialPublicError,
} from "@/services/video-search-social.service"
import {
  loadVideoSearchSocialLocale,
  searchVideoSearchSocialLocales,
  type VideoSearchSocialLocaleData,
  type VideoSearchSocialLocaleOption,
} from "./video-search-social-data"

type LoadFailure = {
  ok: false
  code: "FORBIDDEN" | "INVALID_INPUT" | "LOCALE_NOT_FOUND" | "LOAD_FAILED"
  message: string
}

export type VideoSearchSocialSearchResult =
  | { ok: true; options: VideoSearchSocialLocaleOption[] }
  | LoadFailure

export type VideoSearchSocialLoadResult =
  | { ok: true; data: VideoSearchSocialLocaleData }
  | LoadFailure

export type VideoSearchSocialSaveResult =
  | { ok: true; data: VideoSearchSocialMetadata }
  | VideoSearchSocialPublicError

function loadFailure(error: unknown): LoadFailure {
  const mapped = mapVideoSearchSocialError(error)
  if (
    mapped.code === "FORBIDDEN" ||
    mapped.code === "INVALID_INPUT" ||
    mapped.code === "LOCALE_NOT_FOUND"
  ) {
    return { ok: false, code: mapped.code, message: mapped.message }
  }
  return {
    ok: false,
    code: "LOAD_FAILED",
    message: "Search metadata could not be loaded. Please try again.",
  }
}

function logActionFailure(
  operation: "load" | "save" | "search",
  error: unknown,
) {
  console.error(
    JSON.stringify({
      event: "video_search_social.action_failed",
      operation,
      errorName: error instanceof Error ? error.name : "UnknownError",
    }),
  )
}

export async function searchVideoSearchSocialLocalesAction(input: {
  videoId: string
  query: string
}): Promise<VideoSearchSocialSearchResult> {
  try {
    const user = await requireSession()
    const options = await searchVideoSearchSocialLocales({ user, ...input })
    return { ok: true, options }
  } catch (error) {
    logActionFailure("search", error)
    return loadFailure(error)
  }
}

export async function loadVideoSearchSocialLocaleAction(input: {
  videoLocaleId: string
}): Promise<VideoSearchSocialLoadResult> {
  try {
    const user = await requireSession()
    const data = await loadVideoSearchSocialLocale({ user, ...input })
    return { ok: true, data }
  } catch (error) {
    logActionFailure("load", error)
    return loadFailure(error)
  }
}

export async function saveVideoSearchSocialAction(input: {
  videoLocaleId: string
  searchTitle: string | null
  searchDescription: string | null
  socialImageAssetId: string | null
}): Promise<VideoSearchSocialSaveResult> {
  try {
    const user = await requireSession()
    const data = await createServices(prisma).videoSearchSocial.save({
      user,
      input,
    })
    revalidatePath("/dashboard/videos")
    return { ok: true, data }
  } catch (error) {
    logActionFailure("save", error)
    return mapVideoSearchSocialError(error)
  }
}
