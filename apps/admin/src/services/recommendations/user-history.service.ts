/** Legacy user-history response shape retained for the curated delivery adapter. */
export type UserWatchHistory = {
  mediaId: string
  videoCoreId?: string | null
  videoTitle?: string | null
  completed: boolean
  recentlyTried?: boolean
  qualified?: boolean
}[]
