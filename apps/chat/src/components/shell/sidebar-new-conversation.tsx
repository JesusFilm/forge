import { cn } from "@/lib/cn"

import { type CollapsedStyles } from "./sidebar-collapsed-styles"
import { ComposeIcon } from "./icons"

type NewConversationButtonProps = {
  styles: CollapsedStyles
  onNew: () => void
  onCloseMobile: () => void
}

/**
 * The "New conversation" action. Full-width labeled button when expanded or in
 * the mobile drawer; a centered icon-only target when the desktop rail is
 * collapsed. Starts a fresh conversation and closes the mobile drawer.
 */
export function NewConversationButton({
  styles,
  onNew,
  onCloseMobile,
}: NewConversationButtonProps) {
  return (
    <div className={cn("px-3 pt-4", styles.newButtonWrap)}>
      <button
        type="button"
        onClick={() => {
          onNew()
          onCloseMobile()
        }}
        title="New conversation"
        className={cn(
          "flex w-full items-center gap-2.5 rounded-[10px] border border-linen/10 px-3.5 py-2.5 text-left text-sm font-medium text-linen transition-colors duration-300 hover:border-linen/20 hover:bg-linen/[0.04]",
          styles.newButton,
        )}
      >
        <ComposeIcon className="size-[18px] shrink-0 text-vesper" />
        <span className={cn("whitespace-nowrap", styles.newButtonLabel)}>
          New conversation
        </span>
      </button>
    </div>
  )
}
