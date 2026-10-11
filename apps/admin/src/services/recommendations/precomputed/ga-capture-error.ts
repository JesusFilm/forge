/** An intentional GA capture validation or configuration failure. */
export class GaCaptureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "GaCaptureError"
  }
}
