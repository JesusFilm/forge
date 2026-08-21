const MAX_OPERATOR_DRY_RUN_CONVERSATIONS = 5

export function isSupportResearchLaunchPath(path: readonly string[]): boolean {
  return (
    path.length === 3 &&
    path[0] === "workflows" &&
    path[1] === "daily-support-research" &&
    (path[2] === "start" || path[2] === "start-async")
  )
}

export async function isBoundedSupportResearchDryRun(
  request: Request,
): Promise<boolean> {
  try {
    const body: unknown = await request.clone().json()
    if (!body || typeof body !== "object") return false
    const inputData = (body as { inputData?: unknown }).inputData
    if (!inputData || typeof inputData !== "object") return false
    const input = inputData as Record<string, unknown>
    return (
      input.dryRun === true &&
      Number.isInteger(input.maxConversations) &&
      (input.maxConversations as number) > 0 &&
      (input.maxConversations as number) <=
        MAX_OPERATOR_DRY_RUN_CONVERSATIONS &&
      typeof input.idempotencyKey === "string" &&
      input.idempotencyKey.length > 0 &&
      input.idempotencyKey.length <= 120
    )
  } catch {
    return false
  }
}
