"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const CHAT_URL = "https://issuesiface.com/talk?utm_source=forge-watch"
// TODO: content team to confirm exact URL before promoting beyond v1.
const BIBLE_URL =
  "https://issuesiface.com/bible-question?utm_source=forge-watch"

export type AskYoursPanelProps = {
  open: boolean
  onClose: () => void
}

export function AskYoursPanel({ open, onClose }: AskYoursPanelProps) {
  function handleOpenChange(next: boolean) {
    if (!next) onClose()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-testid="watch-ask-yours-panel"
        className="sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>Ask yours</DialogTitle>
          <DialogDescription>
            Reach out for a one-on-one conversation or send in a Bible question.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <a
            href={CHAT_URL}
            target="_blank"
            rel="noreferrer"
            data-testid="watch-ask-yours-chat-link"
            className="flex flex-col gap-1 rounded-md border border-stone-700 bg-stone-800 px-4 py-3 text-stone-100 transition hover:bg-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          >
            <span className="text-sm font-semibold">Chat with a person</span>
            <span className="text-xs text-stone-400">
              Talk live with someone who can listen and pray with you.
            </span>
          </a>

          <a
            href={BIBLE_URL}
            target="_blank"
            rel="noreferrer"
            data-testid="watch-ask-yours-bible-link"
            className="flex flex-col gap-1 rounded-md border border-stone-700 bg-stone-800 px-4 py-3 text-stone-100 transition hover:bg-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          >
            <span className="text-sm font-semibold">Ask a Bible question</span>
            <span className="text-xs text-stone-400">
              Send a question and get a thoughtful written reply.
            </span>
          </a>
        </div>
      </DialogContent>
    </Dialog>
  )
}
