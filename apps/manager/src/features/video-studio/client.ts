import type { StudioAction } from "@forge/studio-contracts/transport"
export class StudioClientError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}
export async function studioCall<T>(
  action: StudioAction,
  input: unknown,
): Promise<T> {
  const response = await fetch("/api/studio/command", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, input }),
  })
  const data = (await response.json()) as { result: T; error: string }
  if (!response.ok) throw new StudioClientError(response.status, data.error)
  return data.result
}
