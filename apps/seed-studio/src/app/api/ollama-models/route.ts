import { NextResponse } from "next/server"

export async function GET() {
  const ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434"

  try {
    const response = await fetch(`${ollamaUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    })

    if (!response.ok) {
      return NextResponse.json([])
    }

    const data = (await response.json()) as {
      models?: Array<{ name: string }>
    }

    const models = (data.models ?? []).map((m) => ({
      id: m.name,
      label: m.name,
    }))

    return NextResponse.json(models)
  } catch {
    return NextResponse.json([])
  }
}
