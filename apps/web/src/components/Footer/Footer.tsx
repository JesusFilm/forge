import { Separator } from "@/components/ui/separator"

export function Footer() {
  return (
    <footer className="w-full border-t border-border bg-muted/30">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <Separator className="mb-4" />
        <div className="flex min-h-8 items-center justify-center">
          <p className="text-center text-sm text-muted-foreground">
            © {new Date().getFullYear()} Forge. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}
