'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

const EXCLUDED_PATHS = [
  '/admin/field-discovery',
  '/admin/field-mappings',
  '/admin/benchmarks',
  '/admin/users',
  '/admin/integrations',
  '/ops/ai-insights',
]

const NURTURE_SEGMENTS = [
  'CIOs and Tech Leaders of Non-Tech',
  'CEOs and Non-Tech Leaders of Non-Tech',
  'Managing Partners in Private Equity',
  'CTOs and Technology Leaders of Tech',
  'CTOs and Tech Leaders of Funded Tech',
  'CIOs and Tech Leaders of Non-Tech Businesses With Under',
  'CEOs and Non-Tech Leaders of Tech Businesses',
]

const DATE_OPTIONS = [
  { value: '7d',   label: 'Last 7 days'    },
  { value: '30d',  label: 'Last 30 days'   },
  { value: '90d',  label: 'Last 90 days'   },
  { value: '180d', label: 'Last 6 months'  },
  { value: '365d', label: 'Last 12 months' },
]

export default function FilterBar() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()

  if (EXCLUDED_PATHS.some(p => pathname?.includes(p))) return null

  const dateRange = searchParams.get('dateRange') ?? '30d'
  const segment = searchParams.get('segment') ?? ''

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="flex items-center gap-3 px-5 py-2 border-b border-white/5 bg-graphite-900/80 backdrop-blur-sm shrink-0">
      <p className="text-white/20 text-xs font-mono uppercase tracking-widest shrink-0">Filters</p>
      <select
        value={dateRange}
        onChange={e => updateFilter('dateRange', e.target.value)}
        className="bg-graphite-800 border border-white/10 text-white/60 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-pulse-blue/40 cursor-pointer"
      >
        {DATE_OPTIONS.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <select
        value={segment}
        onChange={e => updateFilter('segment', e.target.value)}
        className="bg-graphite-800 border border-white/10 text-white/60 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-pulse-blue/40 cursor-pointer"
      >
        <option value="">All Segments</option>
        {NURTURE_SEGMENTS.map(s => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
    </div>
  )
}
