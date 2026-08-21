"use server"

import { headers } from "next/headers"

import type { PublicUserPlaylistReportInput } from "./user-playlist-public-report"
import { submitPublicUserPlaylistReportRequest } from "./user-playlist-public-report"

export async function submitPublicUserPlaylistReport(
  data: PublicUserPlaylistReportInput,
) {
  return submitPublicUserPlaylistReportRequest({
    data,
    requestHeaders: await headers(),
  })
}
