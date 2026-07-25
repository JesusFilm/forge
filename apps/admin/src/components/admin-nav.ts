import type { LucideIcon } from "lucide-react"
import {
  Activity,
  Bot,
  Clapperboard,
  Database,
  Image,
  KeyRound,
  Languages,
  LayoutDashboard,
  Layers3,
  Search,
  Settings,
  Shield,
  Workflow,
} from "lucide-react"
import type { AdminMessages } from "@/i18n/messages"
import type { Role } from "@/auth/principal"

export type AdminNavSectionKey = Extract<
  keyof AdminMessages["nav"]["sections"],
  string
>
export type AdminNavItemId = Extract<
  keyof AdminMessages["nav"]["items"],
  string
>

export type AdminNavItem = {
  id: AdminNavItemId
  href: string
  section: AdminNavSectionKey
  icon: LucideIcon
}

export const adminNavItems: AdminNavItem[] = [
  {
    id: "dashboard",
    href: "/dashboard",
    section: "overview",
    icon: LayoutDashboard,
  },
  {
    id: "experiences",
    href: "/dashboard/experiences",
    section: "content",
    icon: Layers3,
  },
  {
    id: "videos",
    href: "/dashboard/videos",
    section: "content",
    icon: Clapperboard,
  },
  {
    id: "media",
    href: "/dashboard/media",
    section: "content",
    icon: Image,
  },
  {
    id: "languages",
    href: "/dashboard/languages",
    section: "content",
    icon: Languages,
  },
  {
    id: "systemStatus",
    href: "/dashboard/system-status",
    section: "system",
    icon: Activity,
  },
  {
    id: "workflows",
    href: "/dashboard/workflows",
    section: "system",
    icon: Workflow,
  },
  {
    id: "embeddings",
    href: "/dashboard/embeddings",
    section: "system",
    icon: Database,
  },
  {
    id: "search",
    href: "/dashboard/search",
    section: "system",
    icon: Search,
  },
  {
    id: "users",
    href: "/dashboard/users",
    section: "system",
    icon: Shield,
  },
  {
    id: "partnerKeys",
    href: "/dashboard/partner-keys",
    section: "system",
    icon: KeyRound,
  },
  {
    id: "mcp",
    href: "/dashboard/mcp",
    section: "system",
    icon: Bot,
  },
  {
    id: "settings",
    href: "/dashboard/settings",
    section: "system",
    icon: Settings,
  },
]

export const adminNavSections = Array.from(
  adminNavItems.reduce(
    (map, item) =>
      map.set(item.section, [...(map.get(item.section) ?? []), item]),
    new Map<AdminNavSectionKey, AdminNavItem[]>(),
  ),
).map(([label, items]) => ({ label, items }))

export function isNavItemVisible(role: Role, item: AdminNavItem) {
  if (
    role !== "ADMIN" &&
    (item.id === "users" ||
      item.id === "settings" ||
      item.id === "partnerKeys" ||
      item.id === "mcp")
  ) {
    return false
  }

  return true
}

export function getNavItem(pathname: string) {
  if (pathname === "/dashboard") {
    return adminNavItems.find((item) => item.href === "/dashboard") ?? null
  }

  return (
    adminNavItems.find(
      (item) => item.href !== "/dashboard" && pathname.startsWith(item.href),
    ) ?? null
  )
}
