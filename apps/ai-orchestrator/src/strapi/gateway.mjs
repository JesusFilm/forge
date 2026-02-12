export async function createAiDraftVariant(input) {
  // Intentional boundary: this path can only create draft variants.
  return {
    variantId: `variant_${Date.now()}`,
    state: "ai_draft_ready",
    contentItemId: input.contentItemId
  };
}

export async function publishCanonicalContent() {
  throw new Error("Forbidden: AI orchestrator cannot publish content.");
}
