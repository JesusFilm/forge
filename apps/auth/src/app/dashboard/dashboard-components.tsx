import type { ReactNode } from "react"

export function DashboardPageShell({ children }: { children: ReactNode }) {
  return <section className="grid gap-[22px]">{children}</section>
}

export function DashboardPageHeader({
  eyebrow,
  title,
}: {
  eyebrow: string
  title: ReactNode
}) {
  return (
    <header className="flex items-end justify-between gap-4">
      <div>
        <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-[#ef3340]">
          {eyebrow}
        </p>
        <h2 className="mb-0 mt-0.5 text-3xl font-bold">{title}</h2>
      </div>
    </header>
  )
}

export function DashboardPanel({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-auto rounded-lg border border-[#dedbd2] bg-white">
      {children}
    </div>
  )
}

export function DashboardPanelHeader({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[#ebe8df] p-[18px]">
      {children}
    </div>
  )
}

export function DashboardTable({ children }: { children: ReactNode }) {
  return <table className="w-full border-collapse">{children}</table>
}

export function DashboardTh({ children }: { children: ReactNode }) {
  return (
    <th className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top text-[11px] uppercase tracking-[0.08em] text-[#57534e]">
      {children}
    </th>
  )
}

export function DashboardTd({ children }: { children: ReactNode }) {
  return (
    <td className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top">
      {children}
    </td>
  )
}
