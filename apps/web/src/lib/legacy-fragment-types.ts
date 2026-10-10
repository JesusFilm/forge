import { gql } from "@apollo/client"

type UntypedDocument = {
  loc?: {
    source?: {
      body?: string
    }
  }
}

export function graphql(source: string, dependencies: UntypedDocument[] = []) {
  const dependencySource = dependencies
    .map((dependency) => dependency.loc?.source?.body)
    .filter((body): body is string => typeof body === "string")
    .join("\n")

  return gql([dependencySource, source].filter(Boolean).join("\n"))
}

export type LegacyFragmentValue = ReturnType<typeof JSON.parse>

export type FragmentOf<T> = T extends unknown ? LegacyFragmentValue : never
