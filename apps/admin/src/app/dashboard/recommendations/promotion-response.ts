/** Only recognized refusal envelopes may explain a rejected mutation. */
export async function readPromotionForbiddenReason(
  response: Response,
): Promise<"csrf_failed" | "permission_denied" | null> {
  try {
    const body: unknown = await response.json()
    if (
      body !== null &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      "ok" in body &&
      body.ok === false &&
      "error" in body &&
      (body.error === "csrf_failed" || body.error === "permission_denied")
    )
      return body.error
  } catch {
    // A malformed error response must not imply permission or success.
  }
  return null
}
