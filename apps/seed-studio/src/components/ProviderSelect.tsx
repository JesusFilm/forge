"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/cn"
import {
  AI_PROVIDERS,
  PROVIDER_LABELS,
  PROVIDER_MODELS,
  DEFAULT_MODELS,
  type AIProvider,
  type ModelOption,
} from "@/lib/ai/providers"

type ProviderSelectProps = {
  provider: AIProvider
  model: string
  onProviderChange: (provider: AIProvider) => void
  onModelChange: (model: string) => void
  disabled: boolean
}

const selectClasses = cn(
  "rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5",
  "text-xs font-medium text-neutral-700",
  "transition-colors hover:border-neutral-300",
  "focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100",
  "disabled:cursor-not-allowed disabled:opacity-50",
)

export function ProviderSelect({
  provider,
  model,
  onProviderChange,
  onModelChange,
  disabled,
}: ProviderSelectProps) {
  const [ollamaModels, setOllamaModels] = useState<ModelOption[]>([])

  useEffect(() => {
    if (provider !== "ollama") return
    fetch("/api/ollama-models")
      .then((r) => r.json())
      .then((models: ModelOption[]) => setOllamaModels(models))
      .catch(() => setOllamaModels([]))
  }, [provider])

  const models =
    provider === "ollama" ? ollamaModels : PROVIDER_MODELS[provider]

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={provider}
        onChange={(e) => {
          const next = e.target.value as AIProvider
          onProviderChange(next)
          onModelChange(DEFAULT_MODELS[next])
        }}
        disabled={disabled}
        className={selectClasses}
      >
        {AI_PROVIDERS.map((p) => (
          <option key={p} value={p}>
            {PROVIDER_LABELS[p]}
          </option>
        ))}
      </select>

      {models.length > 0 ? (
        <select
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          disabled={disabled}
          className={selectClasses}
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      ) : provider === "ollama" ? (
        <input
          type="text"
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          disabled={disabled}
          placeholder="model name"
          className={cn(selectClasses, "w-28")}
        />
      ) : null}
    </div>
  )
}
