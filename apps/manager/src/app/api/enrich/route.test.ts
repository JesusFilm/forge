import { describe, expect, it } from "vitest"
import {
  ENRICH_CREATE_CONCURRENCY,
  GET_VIDEOS_WITH_MUX,
  mapWithConcurrencyLimit,
} from "@/app/api/enrich/route"

type QueryNode = {
  kind?: string
  name?: { value?: string }
  arguments?: Array<{
    name?: { value?: string }
    value?: {
      kind?: string
      fields?: Array<{
        name?: { value?: string }
        value?: { kind?: string; value?: string }
      }>
    }
  }>
  selectionSet?: { selections?: QueryNode[] }
}

function findField(
  selections: QueryNode[] | undefined,
  fieldName: string,
): QueryNode | undefined {
  for (const selection of selections ?? []) {
    if (selection.kind !== "Field") continue
    if (selection.name?.value === fieldName) return selection

    const nestedMatch = findField(selection.selectionSet?.selections, fieldName)
    if (nestedMatch) return nestedMatch
  }

  return undefined
}

function getLimitArgumentValue(field: QueryNode | undefined): string | null {
  const pagination = field?.arguments?.find(
    (argument) => argument.name?.value === "pagination",
  )
  if (!pagination?.value || pagination.value.kind !== "ObjectValue") {
    return null
  }

  const limit = pagination.value.fields?.find(
    (entry) => entry.name?.value === "limit",
  )
  if (!limit) {
    return null
  }

  return limit.value?.kind === "IntValue" ? (limit.value.value ?? null) : null
}

describe("GET_VIDEOS_WITH_MUX", () => {
  it("requests all nested variants explicitly", () => {
    const document = GET_VIDEOS_WITH_MUX as QueryNode & {
      definitions?: QueryNode[]
    }
    const operation = document.definitions?.[0]

    expect(operation?.kind).toBe("OperationDefinition")
    if (operation?.kind !== "OperationDefinition" || !operation.selectionSet) {
      return
    }

    const videosField = findField(operation.selectionSet.selections, "videos")
    const variantsField = findField(
      videosField?.selectionSet?.selections,
      "variants",
    )
    const downloadsField = findField(
      variantsField?.selectionSet?.selections,
      "downloads",
    )

    expect(getLimitArgumentValue(variantsField)).toBe("-1")
    expect(getLimitArgumentValue(downloadsField)).toBe("-1")
  })
})

describe("mapWithConcurrencyLimit", () => {
  it("caps concurrent work while preserving result order", async () => {
    let inFlight = 0
    let maxInFlight = 0

    const results = await mapWithConcurrencyLimit(
      Array.from(
        { length: ENRICH_CREATE_CONCURRENCY + 3 },
        (_, index) => index,
      ),
      ENRICH_CREATE_CONCURRENCY,
      async (value) => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)

        await new Promise((resolve) => setTimeout(resolve, 5))

        inFlight -= 1
        return value * 2
      },
    )

    expect(results).toEqual(
      Array.from(
        { length: ENRICH_CREATE_CONCURRENCY + 3 },
        (_, index) => index * 2,
      ),
    )
    expect(maxInFlight).toBe(ENRICH_CREATE_CONCURRENCY)
  })
})
