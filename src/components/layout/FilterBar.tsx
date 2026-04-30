'use client'

import { useEffect, useRef, useState } from 'react'
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

function CampaignMultiSelect({
  campaigns,
  selected,
  onChange,
}: {
  campaigns: string[]
  selected: string[]
  onChange: (selected: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  function toggle(c: string) {
    onChange(selected.includes(c) ? selected.filter(x => x !== c) : [...selected, c])
  }

  const label =
    selected.length === 0 ? 'All Campaigns' :
    selected.length === 1 ? (selected[0].length > 28 ? selected[0].slice(0, 26) + '…' : selected[0]) :
    `${selected.length} campaigns`

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="bg-graphite-800 border border-white/10 text-white/60 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-pulse-blue/40 cursor-pointer flex items-center gap-1.5 max-w-[200px]"
      >
        <span className="truncate">{label}</span>
        <svg className="w-3 h-3 shrink-0 opacity-50" viewBox="0 0 24 24" fill="currentColor">
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 bg-graphite-800 border border-white/10 rounded-lg shadow-xl min-w-[260px] max-h-64 overflow-y-auto">
          {campaigns.length === 0 ? (
            <p className="text-white/30 text-xs px-3 py-2">Loading…</p>
          ) : (
            <>
              <button
                onClick={() => onChange([])}
                className="w-full text-left px-3 py-2 text-xs text-white/40 hover:text-white/70 hover:bg-white/5 border-b border-white/5"
              >
                Clear all
              </button>
              {campaigns.map(c => (
                <label key={c} className="flex items-center gap-2 px-3 py-2 hover:bg-white/5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.includes(c)}
                    onChange={() => toggle(c)}
                    className="accent-pulse-blue shrink-0"
                  />
                  <span className="text-xs text-white/60 truncate">{c}</span>
                </label>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function FilterBar() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [campaigns, setCampaigns] = useState<string[]>([])

  useEffect(() => {
    fetch('/api/campaigns').then(r => r.json()).then(setCampaigns).catch(() => {})
  }, [])

  if (EXCLUDED_PATHS.some(p => pathname?.includes(p))) return null

  const dateRange = searchParams.get('dateRange') ?? '30d'
  const segment = searchParams.get('segment') ?? ''
  const selectedCampaigns = searchParams.getAll('campaign')

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    router.push(`${pathname}?${params.toString()}`)
  }

  function updateCampaigns(selected: string[]) {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('campaign')
    for (const c of selected) params.append('campaign', c)
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
      <CampaignMultiSelect
        campaigns={campaigns}
        selected={selectedCampaigns}
        onChange={updateCampaigns}
      />
    </div>
  )
}
