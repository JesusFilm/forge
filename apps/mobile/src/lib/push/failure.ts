/**
 * The fields the push controllers read off a rejected mutation, by SHAPE. The
 * error class can be absent inside a catch, and `instanceof undefined` throws,
 * so nothing here depends on class identity.
 */
export type PushFailure = {
  code: string
  /** True when replaying the same request cannot improve the answer. */
  definitive: boolean
  /** Admin's push-specific reason, such as `invalid_token_status`. */
  pushCode: string | null
}

export function readPushFailure(error: unknown): PushFailure {
  const shape = (error ?? {}) as {
    code?: unknown
    definitive?: unknown
    pushCode?: unknown
  }
  return {
    code: typeof shape.code === "string" ? shape.code : "UNKNOWN",
    definitive: shape.definitive === true,
    pushCode: typeof shape.pushCode === "string" ? shape.pushCode : null,
  }
}
