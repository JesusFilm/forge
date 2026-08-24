"use server"

import { headers } from "next/headers"

import {
  submitFeedbackWithHeaders,
  type FeedbackActionResult,
} from "@/lib/feedback-action-core"

export async function submitFeedback(
  input: unknown,
): Promise<FeedbackActionResult> {
  return submitFeedbackWithHeaders(input, await headers())
}
