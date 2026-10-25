/**
 * The push write operations mobile sends, by GraphQL operation name.
 * A dependency-free leaf, like the recommendation one beside it:
 * `authHeaders.ts` gates the fleet bearer on it and `operations.ts` pins it to
 * the shared documents.
 */
export const PUSH_OPERATION_NAMES = [
  "RegisterPushDevice",
  "ReportPushOpen",
] as const

export type PushOperationName = (typeof PUSH_OPERATION_NAMES)[number]

const PUSH_OPERATIONS: ReadonlySet<string> = new Set(PUSH_OPERATION_NAMES)

/**
 * KTD7: both push writes run their own admission predicate in admin, and both
 * require the consumer bearer. A missing header is UNAUTHENTICATED there, not
 * a coarser rate-limit bucket.
 */
export function isPushOperation(operationName: string | undefined): boolean {
  return operationName != null && PUSH_OPERATIONS.has(operationName)
}
