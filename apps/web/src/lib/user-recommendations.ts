import { adminUserRecommendationsOperation } from "@forge/admin-graphql/operations"
import { type AdminResultOf, type AdminVariablesOf } from "@forge/admin-graphql"
import client from "@/lib/admin-client"
import { RecommendationRuntimeError } from "@/lib/recommendation-errors"

export type UserRecommendationDelivery = AdminResultOf<
  typeof adminUserRecommendationsOperation
>["userRecommendations"]
export async function getUserRecommendations(
  variables: AdminVariablesOf<typeof adminUserRecommendationsOperation>,
) {
  const result = await client.query({
    query: adminUserRecommendationsOperation,
    variables: { ...variables, count: 6 },
    fetchPolicy: "no-cache",
    context: { fetchOptions: { signal: AbortSignal.timeout(1900) } },
  })
  if (result.error || !result.data?.userRecommendations)
    throw new RecommendationRuntimeError("delivery_unavailable")
  return result.data.userRecommendations
}
