// Tiny conditional-className joiner — no `clsx`/`tailwind-merge` dependency.
// Call sites guard conflicting Tailwind classes with ternaries, so a plain
// truthy-filter join is enough; shared so components don't redeclare it.
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ")
}
