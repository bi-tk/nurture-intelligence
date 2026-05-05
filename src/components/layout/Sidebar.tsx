'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { Role } from '@prisma/client'

interface NavItem {
  label: string
  href: string
  icon: string
  roles: Role[]
}

const NAV: NavItem[] = [
  // Executive
  {
    label: 'Executive Overview',
    href: '/executive',
    icon: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
    roles: ['EXECUTIVE', 'ADMIN', 'SUPER_ADMIN'],
  },
  // Ops
  {
    label: 'Sequence Performance',
    href: '/ops/sequences',
    icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z',
    roles: ['NURTURE_OPS', 'ADMIN', 'SUPER_ADMIN'],
  },
  {
    label: 'Funnel Analysis',
    href: '/ops/funnel',
    icon: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
    roles: ['NURTURE_OPS', 'ADMIN', 'SUPER_ADMIN', 'SALES_LEADERSHIP'],
  },
  {
    label: 'Contact Intelligence',
    href: '/ops/contacts',
    icon: 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z',
    roles: ['NURTURE_OPS', 'ADMIN', 'SUPER_ADMIN', 'SALES_LEADERSHIP'],
  },
  {
    label: 'Segments & Industries',
    href: '/ops/segments',
    icon: 'M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z',
    roles: ['NURTURE_OPS', 'ADMIN', 'SUPER_ADMIN'],
  },
  {
    label: 'AI Insights',
    href: '/ops/ai-insights',
    icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm7 13H5v-.23c0-.62.28-1.2.76-1.58C7.47 15.82 9.64 15 12 15s4.53.82 6.24 2.19c.48.38.76.97.76 1.58V19z',
    roles: ['NURTURE_OPS', 'ADMIN', 'SUPER_ADMIN', 'EXECUTIVE'],
  },
  // Admin
  {
    label: 'Integrations',
    href: '/admin/integrations',
    icon: 'M13 2.05v2.02c3.95.49 7 3.85 7 7.93 0 3.21-1.81 6-4.72 7.72L13 17v5h5l-1.22-1.22C19.91 19.07 22 15.76 22 12c0-5.18-3.95-9.45-9-9.95zM11 2.05C5.95 2.55 2 6.82 2 12c0 3.76 2.09 7.07 5.22 8.78L6 22h5V2.05z',
    roles: ['ADMIN', 'SUPER_ADMIN'],
  },
  {
    label: 'Field Discovery',
    href: '/admin/discovery',
    icon: 'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
    roles: ['ADMIN', 'SUPER_ADMIN'],
  },
  {
    label: 'Benchmarks',
    href: '/admin/benchmarks',
    icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z',
    roles: ['ADMIN', 'SUPER_ADMIN'],
  },
  {
    label: 'User Management',
    href: '/admin/users',
    icon: 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z',
    roles: ['ADMIN', 'SUPER_ADMIN'],
  },
]

interface SidebarProps {
  role: Role
}

export default function Sidebar({ role }: SidebarProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const filtered = NAV.filter((item) => item.roles.includes(role))

  const execItems = filtered.filter((i) => i.href.startsWith('/executive'))
  const opsItems = filtered.filter((i) => i.href.startsWith('/ops'))
  const adminItems = filtered.filter((i) => i.href.startsWith('/admin'))

  // Preserve filter params when navigating between pages (admin pages excluded)
  function navHref(item: NavItem): string {
    if (item.href.startsWith('/admin')) return item.href
    const paramsStr = searchParams.toString()
    return paramsStr ? `${item.href}?${paramsStr}` : item.href
  }

  const renderItem = (item: NavItem) => {
    const active = pathname === item.href || pathname.startsWith(item.href + '/')
    return (
      <Link
        key={item.href}
        href={navHref(item)}
        className={cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
          active
            ? 'bg-pulse-blue/15 text-pulse-blue border border-pulse-blue/20'
            : 'text-white/50 hover:text-white/80 hover:bg-white/5'
        )}
      >
        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
          <path d={item.icon} />
        </svg>
        <span className="truncate">{item.label}</span>
      </Link>
    )
  }

  return (
    <aside className="w-60 shrink-0 flex flex-col h-screen bg-graphite-800 border-r border-white/5">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/5">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 gradient-core-flow rounded flex items-center justify-center">
            <span className="text-white font-bold text-xs">NI</span>
          </div>
          <div>
            <p className="text-white font-bold text-sm leading-tight tracking-tight">Nurture Intelligence</p>
            <p className="text-white/30 text-[10px] font-mono uppercase tracking-widest">by tkxel</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {execItems.length > 0 && (
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-white/25 px-3 mb-2">Executive</p>
            <div className="space-y-0.5">{execItems.map(renderItem)}</div>
          </div>
        )}
        {opsItems.length > 0 && (
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-white/25 px-3 mb-2">Operations</p>
            <div className="space-y-0.5">{opsItems.map(renderItem)}</div>
          </div>
        )}
        {adminItems.length > 0 && (
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-white/25 px-3 mb-2">Admin</p>
            <div className="space-y-0.5">{adminItems.map(renderItem)}</div>
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-white/5">
        <form action="/api/auth/signout" method="POST">
          <button
            type="submit"
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-white/40 hover:text-white/70 hover:bg-white/5 transition-all"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
            </svg>
            Sign out
          </button>
        </form>
      </div>
    </aside>
  )
}
