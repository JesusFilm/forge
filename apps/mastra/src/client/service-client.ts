export type MastraSmokeClientInput = {
  baseUrl?: string
  bearer?: string
  input: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export type MastraSmokeClientResult =
  | { ok: true; agentId: string; echo: string }
  | { ok: false; reason: "config_missing" | "auth_failed" | "network_error" }

export async function callMastraSmoke({
  baseUrl,
  bearer,
  input,
  timeoutMs = 10_000,
  fetchImpl = fetch,
}: MastraSmokeClientInput): Promise<MastraSmokeClientResult> {
  if (!baseUrl || !bearer) {
    return { ok: false, reason: "config_missing" }
  }

  try {
    const response = await fetchImpl(new URL("/forge-smoke", baseUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ input }),
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (response.status === 401) {
      return { ok: false, reason: "auth_failed" }
    }
    if (!response.ok) {
      return { ok: false, reason: "network_error" }
    }

    const body = (await response.json()) as {
      ok?: unknown
      agentId?: unknown
      echo?: unknown
    }
    if (
      body.ok === true &&
      typeof body.agentId === "string" &&
      typeof body.echo === "string"
    ) {
      return {
        ok: true,
        agentId: body.agentId,
        echo: body.echo,
      }
    }
  } catch {
    return { ok: false, reason: "network_error" }
  }

  return { ok: false, reason: "network_error" }
}
