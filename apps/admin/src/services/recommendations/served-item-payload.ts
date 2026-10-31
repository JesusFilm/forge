import type { Prisma } from "@prisma/client"

type SnapshotItem = {
  id: string
  presentation: Prisma.InputJsonValue
  candidateProvenance: Prisma.InputJsonValue
}

/** Keep relational identity and capability rows; move only immutable JSON values. */
export function servedSnapshotCreate<T extends SnapshotItem>(
  rows: T[],
  format: "legacy" | "packed",
) {
  // One item is smaller inline; request payload overhead only amortizes across a slate.
  if (format === "legacy" || rows.length <= 1)
    return { items: { create: rows } }
  const snapshots: Record<
    string,
    Pick<SnapshotItem, "presentation" | "candidateProvenance">
  > = {}
  for (const row of rows) {
    if (Object.hasOwn(snapshots, row.id))
      throw new Error("Duplicate served item snapshot id")
    snapshots[row.id] = {
      presentation: row.presentation,
      candidateProvenance: row.candidateProvenance,
    }
  }
  return {
    servedItemPayload: { version: 1, items: snapshots },
    items: {
      create: rows.map((row) => ({
        ...row,
        presentation: {},
        candidateProvenance: {},
      })),
    },
  }
}

export function servedSnapshotValue<
  T extends {
    id: string
    presentation: Prisma.JsonValue
    candidateProvenance: Prisma.JsonValue
  },
>(payload: Prisma.JsonValue | null, item: T): T {
  if (payload === null) return item
  if (
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    payload.version !== 1 ||
    typeof payload.items !== "object" ||
    payload.items === null ||
    Array.isArray(payload.items)
  )
    throw new Error("Unsupported served item snapshot format")
  const value = payload.items[item.id]
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof value.presentation !== "object" ||
    value.presentation === null ||
    Array.isArray(value.presentation) ||
    typeof value.candidateProvenance !== "object" ||
    value.candidateProvenance === null ||
    Array.isArray(value.candidateProvenance)
  )
    throw new Error("Missing served item snapshot")
  return {
    ...item,
    presentation: value.presentation as Prisma.JsonValue,
    candidateProvenance: value.candidateProvenance as Prisma.JsonValue,
  } as T
}
