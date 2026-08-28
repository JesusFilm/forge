import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { expect, it, vi } from "vitest"

import type { Wiring } from "../src/main.js"
import { runQuery } from "./query.js"

it("loads package-local environment files without overriding injected values", async () => {
  const packageDirectory = await mkdtemp(join(tmpdir(), "forge-rag-query-"))
  await writeFile(
    join(packageDirectory, ".env"),
    "DATABASE_URL=postgresql://file:file@file.example.test/rag\nOPENROUTER_API_KEY=file-key\n",
  )
  await writeFile(
    join(packageDirectory, ".env.local"),
    "OPENROUTER_API_KEY=local-key\nEMBED_MODEL_ID=local-model\n",
  )

  const search = vi.fn().mockResolvedValue([])
  const shutdown = vi.fn().mockResolvedValue(undefined)
  const createWiring = vi.fn(
    () =>
      ({
        retriever: { search },
        shutdown,
      }) as unknown as Wiring,
  )

  await runQuery(["--top-k", "3", "hope"], {
    packageDirectory,
    environment: {
      DATABASE_URL: "postgresql://injected:injected@runtime.example.test/rag",
    },
    createWiring,
    log: vi.fn(),
  })

  expect(createWiring).toHaveBeenCalledWith(
    expect.objectContaining({
      DATABASE_URL: "postgresql://injected:injected@runtime.example.test/rag",
      OPENROUTER_API_KEY: "local-key",
      EMBED_MODEL_ID: "local-model",
    }),
  )
  expect(search).toHaveBeenCalledWith("hope", { topK: 3 })
  expect(shutdown).toHaveBeenCalledOnce()
})
