/** Coverage is a valid empty/partial result; transport failures are not. */
export function recommendationDeliveryState(delivery: {
  result: string
  reason: string | null
  items: readonly unknown[]
}): "ready" | "empty" | "retry" | "error" {
  if (delivery.result !== "unavailable")
    return delivery.items.length > 0 ? "ready" : "empty"
  if (delivery.reason === "coverage_unavailable") return "empty"
  if (delivery.reason === "cooldown" || delivery.reason === "in_flight")
    return "retry"
  return "error"
}
