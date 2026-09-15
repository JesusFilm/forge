export const EMBEDDING_DIMENSIONS = 1536

export function toVectorLiteral(vector: readonly number[]): string {
  if (vector.length === 0) throw new Error("embedding vector is empty")
  vector.forEach((value, index) => {
    if (!Number.isFinite(value)) {
      throw new Error(`embedding contains a non-finite value at index ${index}`)
    }
  })
  return `[${vector.join(",")}]`
}

export function assertQueryDimensions(vector: readonly number[]): void {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `query vector has ${vector.length} dims; expected ${EMBEDDING_DIMENSIONS}`,
    )
  }
}
