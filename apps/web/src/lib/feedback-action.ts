"use server"

import { headers } from "next/headers"

import {
  addFeedbackFollowUpEmail as addFeedbackFollowUpEmailCore,
  submitFeedbackWithHeaders,
  type FeedbackActionResult,
  type FeedbackFollowUpEmailResult,
} from "@/lib/feedback-action-core"

export async function submitFeedback(
  input: unknown,
): Promise<FeedbackActionResult> {
  return submitFeedbackWithHeaders(input, await headers())
}

export async function addFeedbackFollowUpEmail(
  input: unknown,
): Promise<FeedbackFollowUpEmailResult> {
  return addFeedbackFollowUpEmailCore(input)
}
