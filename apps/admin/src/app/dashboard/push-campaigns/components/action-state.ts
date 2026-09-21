/**
 * What every campaign action answers with, and where the pages live.
 *
 * This module holds no action. A module carrying the top-level `"use server"`
 * directive may export async functions only, so the constants the forms and
 * the actions share have to sit beside it.
 */

export const PUSH_CAMPAIGNS_PATH = "/dashboard/push-campaigns"
export const PUSH_TEST_DEVICES_PATH = "/dashboard/push-campaigns/test-devices"

export type PushActionState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; reason: string }

export const PUSH_ACTION_IDLE: PushActionState = { status: "idle" }

/**
 * The one spelling of a campaign's own path. `revalidatePath` matches this
 * string against the route, and a campaign id is a cuid, so it needs no
 * escaping in either a link or a revalidation.
 */
export function pushCampaignPath(campaignId: string): string {
  return `${PUSH_CAMPAIGNS_PATH}/${campaignId}`
}
