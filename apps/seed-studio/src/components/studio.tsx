"use client"

import { useState } from "react"
import { Sparkles } from "lucide-react"
import { cn } from "@/lib/cn"
import { useChat } from "@/lib/chat/use-chat"
import {
  DEFAULT_PROVIDER,
  DEFAULT_MODELS,
  type AIProvider,
} from "@/lib/ai/providers"

import { ChatPanel } from "./chat/ChatPanel"
import { PreviewPanel } from "./preview/PreviewPanel"
import { ProviderSelect } from "./ProviderSelect"
import { PublishButton } from "./publish/PublishButton"

export function Studio() {
  const [provider, setProvider] = useState<AIProvider>(DEFAULT_PROVIDER)
  const [model, setModel] = useState(DEFAULT_MODELS[DEFAULT_PROVIDER])
  const [savedSlug, setSavedSlug] = useState<string | null>(null)
  const {
    messages,
    experience,
    isLoading,
    error,
    streamingText,
    statusText,
    sendMessage,
    stopGenerating,
    clearChat,
  } = useChat(provider, model)

  const handleClearChat = () => {
    setSavedSlug(null)
    clearChat()
  }

  return (
    <div className="flex h-screen flex-col">
      <header
        className={cn(
          "flex items-center justify-between border-b border-neutral-200",
          "bg-white px-4 py-3",
        )}
      >
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg",
              "bg-primary-500",
            )}
          >
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <h1 className="text-sm font-semibold text-neutral-900">
            Seed Studio
          </h1>
          {messages.length > 0 ? (
            <button
              type="button"
              onClick={handleClearChat}
              className="ml-2 text-xs text-neutral-400 hover:text-neutral-600"
            >
              New chat
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <ProviderSelect
            provider={provider}
            model={model}
            onProviderChange={setProvider}
            onModelChange={setModel}
            disabled={isLoading}
          />
          <PublishButton
            experience={experience}
            savedSlug={savedSlug}
            onSaved={setSavedSlug}
          />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-2/5 flex-col border-r border-neutral-200 bg-white">
          <ChatPanel
            messages={messages}
            isLoading={isLoading}
            error={error}
            streamingText={streamingText}
            statusText={statusText}
            onSendMessage={sendMessage}
            onStopGenerating={stopGenerating}
          />
        </div>
        <div className="w-3/5 bg-neutral-50">
          <PreviewPanel experience={experience} />
        </div>
      </div>
    </div>
  )
}
